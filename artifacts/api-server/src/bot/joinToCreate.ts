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
  type Client,
  type Guild,
  type Message,
  type ModalSubmitInteraction,
  type VoiceChannel,
  type VoiceState,
} from "discord.js";
import { logger } from "../lib/logger";

// Temporary channels created by the bot, mapped channelId -> ownerId. State is in-memory only.
const tempChannels = new Map<string, string>();

// Per-guild VoiceMaster configuration. State is in-memory only and resets on restart.
export const hubsByGuild = new Map<string, Set<string>>();
export const templateByGuild = new Map<string, string>();
export const defaultLimitByGuild = new Map<string, number>();

export const DEFAULT_NAME_TEMPLATE = "{user}'s channel";

// Per-guild count of temp channels created, used for the {count} placeholder.
const createdCountByGuild = new Map<string, number>();

function renderChannelName(template: string, displayName: string, count: number): string {
  const name = template
    .replaceAll("{user}", displayName)
    .replaceAll("{count}", String(count))
    .trim()
    .slice(0, 100);
  return name || `${displayName}'s channel`.slice(0, 100);
}

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

type AccessAction = "lock" | "unlock" | "hide" | "show";

// Applies a lock/unlock/hide/show change to the @everyone overwrite and returns the confirmation text.
async function applyAccessAction(
  channel: VoiceChannel,
  guild: Guild,
  action: AccessAction,
): Promise<string> {
  const everyone = guild.roles.everyone;
  switch (action) {
    case "lock":
      await channel.permissionOverwrites.edit(everyone, { Connect: false });
      return "🔒 Channel locked.";
    case "unlock":
      await channel.permissionOverwrites.edit(everyone, { Connect: null });
      return "🔓 Channel unlocked.";
    case "hide":
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: false });
      return "🙈 Channel hidden.";
    case "show":
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: null });
      return "👁️ Channel visible.";
  }
}

function isAccessAction(action: string): action is AccessAction {
  return action === "lock" || action === "unlock" || action === "hide" || action === "show";
}

// Returns a user-facing reason the claim is not allowed, or null when the claim is valid.
function getClaimError(channel: VoiceChannel, userId: string): string | null {
  const ownerId = tempChannels.get(channel.id);
  if (ownerId === userId) return "You already own this channel.";
  if (!channel.members.has(userId)) return "You must be in the voice channel to claim it.";
  if (ownerId && channel.members.has(ownerId)) return "The channel owner is still in the channel.";
  return null;
}

async function performClaim(channel: VoiceChannel, userId: string): Promise<void> {
  const ownerId = tempChannels.get(channel.id);
  tempChannels.set(channel.id, userId);
  try {
    await transferOwnership(channel, userId, ownerId ?? userId);
  } catch (err) {
    if (ownerId) tempChannels.set(channel.id, ownerId);
    throw err;
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

    const guildId = newState.guild.id;
    const count = (createdCountByGuild.get(guildId) ?? 0) + 1;
    const template = templateByGuild.get(guildId) ?? DEFAULT_NAME_TEMPLATE;
    const defaultLimit = defaultLimitByGuild.get(guildId) ?? 0;

    created = await newState.guild.channels.create({
      name: renderChannelName(template, member.displayName, count),
      type: ChannelType.GuildVoice,
      parent: categoryId,
      userLimit: defaultLimit,
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
    createdCountByGuild.set(guildId, count);

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
    const claimError = getClaimError(channel, interaction.user.id);
    if (claimError) {
      await interaction.reply({ content: claimError, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await performClaim(channel, interaction.user.id);
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

  if (isAccessAction(action)) {
    await interaction.editReply({ content: await applyAccessAction(channel, guild, action) });
    return;
  }

  switch (action) {
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

const VC_USAGE =
  "Usage: `!vc <lock|unlock|hide|show|ghost|unghost|limit|name|bitrate|region|permit|reject|kick|pull|drag|transfer|claim|info>`";

// Alternate subcommand names mapped to their canonical equivalents.
const VC_ALIASES: Record<string, string> = {
  ghost: "hide",
  unghost: "show",
  drag: "pull",
};

export async function handleVcCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  const voice = message.member?.voice.channel;
  if (!guild || !voice || voice.type !== ChannelType.GuildVoice || !tempChannels.has(voice.id)) {
    await message.reply("You must be in a temporary voice channel.");
    return;
  }
  const channel: VoiceChannel = voice;

  const rawSub = args[0]?.toLowerCase() ?? "";
  const sub = Object.hasOwn(VC_ALIASES, rawSub) ? (VC_ALIASES[rawSub] ?? rawSub) : rawSub;
  const ownerId = tempChannels.get(channel.id);

  try {
    if (sub === "info") {
      const overwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
      const locked = overwrite?.deny.has(PermissionFlagsBits.Connect) ?? false;
      const hidden = overwrite?.deny.has(PermissionFlagsBits.ViewChannel) ?? false;
      const embed = new EmbedBuilder()
        .setTitle("Voice Channel Info")
        .addFields(
          { name: "Owner", value: ownerId ? `<@${ownerId}>` : "None", inline: true },
          { name: "Name", value: channel.name, inline: true },
          { name: "User Limit", value: channel.userLimit === 0 ? "None" : String(channel.userLimit), inline: true },
          { name: "Locked", value: locked ? "Yes" : "No", inline: true },
          { name: "Hidden", value: hidden ? "Yes" : "No", inline: true },
          { name: "Members", value: String(channel.members.size), inline: true },
        );
      await message.reply({ embeds: [embed] });
      return;
    }

    if (sub === "claim") {
      const claimError = getClaimError(channel, message.author.id);
      if (claimError) {
        await message.reply(claimError);
        return;
      }
      await performClaim(channel, message.author.id);
      await message.reply("You are now the owner of this channel.");
      return;
    }

    const isOwnerCommand =
      isAccessAction(sub) ||
      ["limit", "name", "permit", "reject", "kick", "move", "pull", "bitrate", "region", "transfer"].includes(sub);
    if (!isOwnerCommand) {
      await message.reply(VC_USAGE);
      return;
    }

    if (ownerId !== message.author.id) {
      await message.reply(OWNER_ONLY_MESSAGE);
      return;
    }

    if (isAccessAction(sub)) {
      await message.reply(await applyAccessAction(channel, guild, sub));
      return;
    }

    if (sub === "limit") {
      const raw = args[1] ?? "";
      const limit = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
      if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
        await message.reply("Provide a user limit between 0 and 99 (0 removes the limit).");
        return;
      }
      await channel.setUserLimit(limit);
      await message.reply(limit === 0 ? "👥 User limit removed." : `👥 User limit set to ${limit}.`);
      return;
    }

    if (sub === "bitrate") {
      const raw = args[1] ?? "";
      const kbps = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
      if (!Number.isInteger(kbps) || kbps < 8 || kbps > 96) {
        await message.reply("Provide a bitrate between 8 and 96 (kbps).");
        return;
      }
      const bitrate = Math.min(kbps * 1000, guild.maximumBitrate);
      await channel.setBitrate(bitrate, "Join to Create: bitrate changed by owner");
      await message.reply(`🎚️ Bitrate set to ${Math.floor(bitrate / 1000)} kbps.`);
      return;
    }

    if (sub === "region") {
      const region = (args[1] ?? "").toLowerCase();
      if (!region) {
        await message.reply("Provide a region name (e.g. `us-east`, `europe`) or `auto`.");
        return;
      }
      try {
        await channel.setRTCRegion(region === "auto" ? null : region, "Join to Create: region changed by owner");
      } catch (err) {
        logger.warn({ err, guildId: guild.id, channelId: channel.id, region }, "Failed to set voice region");
        await message.reply("That region isn't valid. Try `auto` or a Discord voice region such as `us-east`.");
        return;
      }
      await message.reply(region === "auto" ? "🌐 Region set to automatic." : `🌐 Region set to **${region}**.`);
      return;
    }

    if (sub === "name") {
      const name = args.slice(1).join(" ").trim().slice(0, 100);
      if (!name) {
        await message.reply("Provide a new channel name.");
        return;
      }
      await channel.setName(name, "Join to Create: renamed by owner");
      await message.reply(`✏️ Channel renamed to **${name}**.`);
      return;
    }

    // Remaining subcommands all target a mentioned member.
    const target = message.mentions.members?.first();
    if (!target) {
      await message.reply(`Mention a member, e.g. \`!vc ${sub} @user\`.`);
      return;
    }

    if (sub === "transfer") {
      if (target.id === ownerId) {
        await message.reply("You already own this channel.");
        return;
      }
      if (target.user.bot) {
        await message.reply("You can't transfer ownership to a bot.");
        return;
      }
      if (target.voice.channelId !== channel.id) {
        await message.reply("That member is not in your channel.");
        return;
      }
      const previousOwnerId = ownerId ?? message.author.id;
      tempChannels.set(channel.id, target.id);
      try {
        await transferOwnership(channel, target.id, previousOwnerId);
      } catch (err) {
        tempChannels.set(channel.id, previousOwnerId);
        throw err;
      }
      await message.reply(`👑 Transferred ownership to <@${target.id}>.`);
      return;
    }

    if (sub === "move" || sub === "pull") {
      if (target.voice.channelId === channel.id) {
        await message.reply("That member is already in your channel.");
        return;
      }
      if (!target.voice.channel) {
        await message.reply("That member is not in a voice channel.");
        return;
      }
      await target.voice.setChannel(channel, "Join to Create: pulled by owner");
      await message.reply(`Pulled <@${target.id}> into the channel.`);
      return;
    }

    if (target.id === ownerId) {
      await message.reply("You can't do that to the channel owner.");
      return;
    }

    if (sub === "permit") {
      await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true });
      await message.reply(`✅ Permitted <@${target.id}>.`);
    } else if (sub === "reject") {
      await channel.permissionOverwrites.edit(target.id, { Connect: false, ViewChannel: false });
      if (target.voice.channelId === channel.id) {
        await target.voice.disconnect("Join to Create: rejected by owner");
      }
      await message.reply(`⛔ Rejected <@${target.id}>.`);
    } else if (sub === "kick") {
      if (target.voice.channelId !== channel.id) {
        await message.reply("That member is not in your channel.");
        return;
      }
      await target.voice.disconnect("Join to Create: kicked by owner");
      await message.reply(`🥾 Kicked <@${target.id}> from the channel.`);
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id, channelId: channel.id, sub }, "Failed to run !vc command");
    await message.reply("Something went wrong running that command.").catch(() => {});
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

  // Ignore events caused by the bot itself, and by other bots.
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot || member.id === client.user?.id) return;

  if (oldState.channelId === newState.channelId) return;

  const isHub =
    !!newState.channelId &&
    (hubsByGuild.get(newState.guild.id)?.has(newState.channelId) === true ||
      (!!lobbyId && newState.channelId === lobbyId));

  if (isHub) {
    await createTempChannel(client, newState);
  }

  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    await cleanupTempChannel(oldState);
  }
}
