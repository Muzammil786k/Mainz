import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type VoiceChannel,
  type VoiceState,
} from "discord.js";
import { logger } from "../lib/logger";

// Temporary channels created by the bot, mapped channelId -> ownerId. State is in-memory only.
const tempChannels = new Map<string, string>();

const JTC_PREFIX = "jtc:";
const RENAME_MODAL_ID = "jtc:rename_modal";
const RENAME_INPUT_ID = "name";
const USER_LIMITS = [0, 2, 5, 10];
const OWNER_ONLY_MESSAGE = "Only the channel owner can use this.";

function buildControlPanel(ownerId: string): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("Voice Channel Controls")
    .setDescription(
      [
        `Owner: <@${ownerId}>`,
        "",
        "🔒 Lock / 🔓 Unlock — control who can join",
        "🙈 Hide / 👁️ Show — control who can see the channel",
        "👥 Limit — cycle the user limit (none, 2, 5, 10)",
        "✏️ Rename — change the channel name",
        "👑 Claim — take ownership when the owner has left",
      ].join("\n"),
    );

  const button = (id: string, label: string): ButtonBuilder =>
    new ButtonBuilder().setCustomId(`${JTC_PREFIX}${id}`).setLabel(label).setStyle(ButtonStyle.Secondary);

  const rowOne = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button("lock", "Lock"),
    button("unlock", "Unlock"),
    button("hide", "Hide"),
    button("show", "Show"),
  );
  const rowTwo = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button("limit", "Limit"),
    button("rename", "Rename"),
    button("claim", "Claim"),
  );

  return { embeds: [embed], components: [rowOne, rowTwo] };
}

async function transferOwnership(
  channel: VoiceChannel,
  newOwnerId: string,
  oldOwnerId: string,
): Promise<void> {
  await channel.permissionOverwrites.edit(newOwnerId, {
    ViewChannel: true,
    Connect: true,
    ManageChannels: true,
    MoveMembers: true,
  });
  if (oldOwnerId !== newOwnerId) {
    await channel.permissionOverwrites.edit(oldOwnerId, {
      ManageChannels: null,
      MoveMembers: null,
    });
  }
}

// Members currently having a channel created for them, to avoid duplicates on rapid rejoins.
const pendingMembers = new Set<string>();

async function createTempChannel(client: Client, newState: VoiceState): Promise<void> {
  const member = newState.member;
  const lobby = newState.channel;
  if (!member || !lobby) return;

  const pendingKey = `${newState.guild.id}:${member.id}`;
  if (pendingMembers.has(pendingKey)) return;
  pendingMembers.add(pendingKey);

  let created: VoiceChannel | null = null;
  try {
    const categoryId = process.env["JTC_CATEGORY_ID"] || lobby.parentId || undefined;

    created = await newState.guild.channels.create({
      name: `${member.displayName}'s Channel`,
      type: ChannelType.GuildVoice,
      parent: categoryId,
      permissionOverwrites: [
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers,
          ],
        },
      ],
    });
    tempChannels.set(created.id, member.id);

    // The member may have left the lobby while the channel was being created.
    if (member.voice.channelId !== lobby.id) {
      tempChannels.delete(created.id);
      await created.delete("Join to Create: member left before being moved");
      return;
    }

    await member.voice.setChannel(created, "Join to Create");
    logger.info(
      { guildId: newState.guild.id, userId: member.id, channelId: created.id },
      "Created join-to-create channel",
    );

    // A failure to post the panel must not tear down a channel the member is already in.
    await created.send(buildControlPanel(member.id)).catch((sendErr) => {
      logger.error({ err: sendErr, channelId: created?.id }, "Failed to send join-to-create control panel");
    });
  } catch (err) {
    logger.error({ err, guildId: newState.guild.id, userId: member.id }, "Failed to create join-to-create channel");
    if (created) {
      tempChannels.delete(created.id);
      await created.delete("Join to Create: failed to move member").catch((deleteErr) => {
        logger.error({ err: deleteErr, channelId: created?.id }, "Failed to clean up join-to-create channel");
      });
    }
  } finally {
    pendingMembers.delete(pendingKey);
  }
}

async function cleanupTempChannel(oldState: VoiceState): Promise<void> {
  const channel = oldState.channel;
  if (!channel || !tempChannels.has(channel.id)) return;

  if (channel.members.size !== 0) {
    // The owner left but others remain: hand the channel to the first remaining member.
    const ownerId = tempChannels.get(channel.id);
    if (!ownerId || channel.members.has(ownerId) || channel.type !== ChannelType.GuildVoice) return;

    const nextOwner = channel.members.find((m) => !m.user.bot);
    if (!nextOwner) return;

    tempChannels.set(channel.id, nextOwner.id);
    try {
      await transferOwnership(channel, nextOwner.id, ownerId);
      logger.info(
        { guildId: oldState.guild.id, channelId: channel.id, ownerId: nextOwner.id },
        "Transferred join-to-create channel ownership",
      );
      await channel.send({ content: `👑 <@${nextOwner.id}> is now the owner of this channel.` });
    } catch (err) {
      logger.error({ err, guildId: oldState.guild.id, channelId: channel.id }, "Failed to transfer join-to-create ownership");
    }
    return;
  }

  tempChannels.delete(channel.id);
  try {
    await channel.delete("Join to Create: channel is empty");
    logger.info({ guildId: oldState.guild.id, channelId: channel.id }, "Deleted empty join-to-create channel");
  } catch (err) {
    logger.error({ err, guildId: oldState.guild.id, channelId: channel.id }, "Failed to delete join-to-create channel");
  }
}

function resolveTempChannel(interaction: ButtonInteraction | ModalSubmitInteraction): VoiceChannel | null {
  const channel = interaction.guild?.channels.cache.get(interaction.channelId ?? "");
  if (!channel || channel.type !== ChannelType.GuildVoice || !tempChannels.has(channel.id)) return null;
  return channel;
}

async function handleJtcButton(interaction: ButtonInteraction): Promise<void> {
  const action = interaction.customId.slice(JTC_PREFIX.length);
  const guild = interaction.guild;
  const channel = resolveTempChannel(interaction);
  if (!guild || !channel) {
    await interaction.reply({
      content: "This channel is no longer a temporary voice channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ownerId = tempChannels.get(channel.id);

  if (action === "claim") {
    if (ownerId === interaction.user.id) {
      await interaction.reply({ content: "You already own this channel.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!channel.members.has(interaction.user.id)) {
      await interaction.reply({
        content: "You must be in the voice channel to claim it.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (ownerId && channel.members.has(ownerId)) {
      await interaction.reply({
        content: "The channel owner is still in the channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    tempChannels.set(channel.id, interaction.user.id);
    try {
      await transferOwnership(channel, interaction.user.id, ownerId ?? interaction.user.id);
    } catch (err) {
      if (ownerId) tempChannels.set(channel.id, ownerId);
      throw err;
    }
    await interaction.editReply({ content: "You are now the owner of this channel." });
    return;
  }

  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: OWNER_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "rename") {
    const modal = new ModalBuilder().setCustomId(RENAME_MODAL_ID).setTitle("Rename Channel");
    const input = new TextInputBuilder()
      .setCustomId(RENAME_INPUT_ID)
      .setLabel("New channel name")
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(100)
      .setValue(channel.name.slice(0, 100))
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const everyone = guild.roles.everyone;

  switch (action) {
    case "lock":
      await channel.permissionOverwrites.edit(everyone, { Connect: false });
      await interaction.editReply({ content: "🔒 Channel locked." });
      break;
    case "unlock":
      await channel.permissionOverwrites.edit(everyone, { Connect: null });
      await interaction.editReply({ content: "🔓 Channel unlocked." });
      break;
    case "hide":
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: false });
      await interaction.editReply({ content: "🙈 Channel hidden." });
      break;
    case "show":
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: null });
      await interaction.editReply({ content: "👁️ Channel visible." });
      break;
    case "limit": {
      const index = USER_LIMITS.indexOf(channel.userLimit);
      const next = USER_LIMITS[(index + 1) % USER_LIMITS.length] ?? 0;
      await channel.setUserLimit(next);
      await interaction.editReply({
        content: next === 0 ? "👥 User limit removed." : `👥 User limit set to ${next}.`,
      });
      break;
    }
    default:
      await interaction.editReply({ content: "Unknown action." });
  }
}

async function handleJtcRenameSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const channel = resolveTempChannel(interaction);
  if (!channel) {
    await interaction.reply({
      content: "This channel is no longer a temporary voice channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (tempChannels.get(channel.id) !== interaction.user.id) {
    await interaction.reply({ content: OWNER_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }

  const name = interaction.fields.getTextInputValue(RENAME_INPUT_ID).trim().slice(0, 100);
  if (!name) {
    await interaction.reply({ content: "Channel name cannot be empty.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Discord rate limits channel renames, so acknowledge first and edit once the rename completes.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await channel.setName(name, "Join to Create: renamed by owner");
  await interaction.editReply({ content: `✏️ Channel renamed to **${name}**.` });
}

export async function handleVoiceSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  const current = guild?.voiceStates.cache.get(interaction.user.id)?.channel;
  if (!guild || !current || current.type !== ChannelType.GuildVoice || !tempChannels.has(current.id)) {
    await interaction.reply({
      content: "You are not in a temporary voice channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const channel = current;

  const ownerId = tempChannels.get(channel.id);
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: OWNER_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const target = interaction.options.getUser("user");
  if ((subcommand === "reject" || subcommand === "kick") && target?.id === ownerId) {
    await interaction.reply({ content: "You can't target the channel owner.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const everyone = guild.roles.everyone;
  logger.info({ guildId: guild.id, channelId: channel.id, userId: interaction.user.id, subcommand }, "Voice slash command");

  switch (subcommand) {
    case "lock":
      await channel.permissionOverwrites.edit(everyone, { Connect: false });
      await interaction.editReply({ content: "🔒 Channel locked." });
      break;
    case "unlock":
      await channel.permissionOverwrites.edit(everyone, { Connect: null });
      await interaction.editReply({ content: "🔓 Channel unlocked." });
      break;
    case "hide":
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: false });
      await interaction.editReply({ content: "🙈 Channel hidden." });
      break;
    case "show":
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: null });
      await interaction.editReply({ content: "👁️ Channel visible." });
      break;
    case "limit": {
      const limit = interaction.options.getInteger("amount", true);
      await channel.setUserLimit(limit);
      await interaction.editReply({
        content: limit === 0 ? "👥 User limit removed." : `👥 User limit set to ${limit}.`,
      });
      break;
    }
    case "rename": {
      const name = interaction.options.getString("name", true).trim().slice(0, 100);
      if (!name) {
        await interaction.editReply({ content: "Channel name cannot be empty." });
        break;
      }
      await channel.setName(name, "Join to Create: renamed by owner");
      await interaction.editReply({ content: `✏️ Channel renamed to **${name}**.` });
      break;
    }
    case "permit": {
      const user = interaction.options.getUser("user", true);
      await channel.permissionOverwrites.edit(user, { Connect: true, ViewChannel: true });
      await interaction.editReply({ content: `✅ <@${user.id}> can now join this channel.` });
      break;
    }
    case "reject": {
      const user = interaction.options.getUser("user", true);
      await channel.permissionOverwrites.edit(user, { Connect: false, ViewChannel: false });
      await channel.members.get(user.id)?.voice.disconnect("Join to Create: rejected by owner");
      await interaction.editReply({ content: `🚫 <@${user.id}> can no longer join this channel.` });
      break;
    }
    case "kick": {
      const user = interaction.options.getUser("user", true);
      const member = channel.members.get(user.id);
      if (!member) {
        await interaction.editReply({ content: "That user is not in your voice channel." });
        break;
      }
      await member.voice.disconnect("Join to Create: kicked by owner");
      await interaction.editReply({ content: `👢 <@${user.id}> was disconnected from the channel.` });
      break;
    }
    default:
      await interaction.editReply({ content: "Unknown subcommand." });
  }
}

export async function handleJtcInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction,
): Promise<void> {
  if (!interaction.customId.startsWith(JTC_PREFIX)) return;

  if (interaction.isButton()) {
    await handleJtcButton(interaction);
  } else if (interaction.isModalSubmit() && interaction.customId === RENAME_MODAL_ID) {
    await handleJtcRenameSubmit(interaction);
  }
}

export async function handleVoiceStateUpdate(
  client: Client,
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const lobbyId = process.env["JTC_LOBBY_CHANNEL_ID"];
  if (!lobbyId) return;

  // Ignore events caused by the bot itself, and by other bots.
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot || member.id === client.user?.id) return;

  if (oldState.channelId === newState.channelId) return;

  if (newState.channelId === lobbyId) {
    await createTempChannel(client, newState);
  }

  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    await cleanupTempChannel(oldState);
  }
}
