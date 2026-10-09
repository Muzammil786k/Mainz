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
import { eq } from "drizzle-orm";
import { db, botJoinToCreateTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { premiumColors } from "./presentation";

interface JtcConfig {
  lobbyId: string;
  categoryId: string | null;
  source: "guild" | "env";
}

const CONFIG_CACHE_MS = 15_000;
const configCache = new Map<string, { expiresAt: number; value: JtcConfig | null }>();

function envJtcConfig(): JtcConfig | null {
  const lobbyId = process.env["JTC_LOBBY_CHANNEL_ID"];
  if (!lobbyId) return null;
  return { lobbyId, categoryId: process.env["JTC_CATEGORY_ID"] || null, source: "env" };
}

// Per-guild config stored in the database, falling back to the JTC_* environment variables.
async function getJtcConfig(guildId: string): Promise<JtcConfig | null> {
  const cached = configCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const [row] = await db
      .select()
      .from(botJoinToCreateTable)
      .where(eq(botJoinToCreateTable.guildId, guildId))
      .limit(1);
    const value: JtcConfig | null = row
      ? { lobbyId: row.lobbyChannelId, categoryId: row.categoryId, source: "guild" }
      : envJtcConfig();
    configCache.set(guildId, { expiresAt: Date.now() + CONFIG_CACHE_MS, value });
    return value;
  } catch (err) {
    logger.error({ err, guildId }, "Failed to load join-to-create config");
    return envJtcConfig();
  }
}

async function setJtcConfig(guildId: string, lobbyId: string, categoryId: string | null): Promise<void> {
  await db
    .insert(botJoinToCreateTable)
    .values({ guildId, lobbyChannelId: lobbyId, categoryId })
    .onConflictDoUpdate({
      target: botJoinToCreateTable.guildId,
      set: { lobbyChannelId: lobbyId, categoryId, updatedAt: new Date() },
    });
  configCache.delete(guildId);
}

async function removeJtcConfig(guildId: string): Promise<boolean> {
  const deleted = await db
    .delete(botJoinToCreateTable)
    .where(eq(botJoinToCreateTable.guildId, guildId))
    .returning({ guildId: botJoinToCreateTable.guildId });
  configCache.delete(guildId);
  return deleted.length > 0;
}

// Temporary channels created by the bot, mapped channelId -> ownerId. State is in-memory only.
const tempChannels = new Map<string, string>();

const JTC_PREFIX = "jtc:";
const RENAME_MODAL_ID = "jtc:rename_modal";
const TRANSFER_MODAL_ID = "jtc:transfer_modal";
const RENAME_INPUT_ID = "name";
const TRANSFER_INPUT_ID = "owner";
const USER_LIMITS = [0, 2, 5, 10];
const OWNER_ONLY_MESSAGE = "Only the channel owner can use this.";

function buildControlPanel(ownerId: string): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setColor(premiumColors.brand)
    .setTitle("Voice Channel Controls")
    .setDescription(
      [
        `Owner: <@${ownerId}>`,
        "",
        "🔒 Lock / 🔓 Unlock — control who can join",
        "🙈 Hide / 👁️ Show — control who can see the channel",
        "👥 Limit — cycle the user limit (none, 2, 5, 10)",
        "✏️ Rename — change the channel name",
        "👑 Transfer — pass ownership to another member in the VC",
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
    button("transfer", "Transfer"),
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

async function createTempChannel(
  client: Client,
  newState: VoiceState,
  config: JtcConfig,
): Promise<void> {
  const member = newState.member;
  const lobby = newState.channel;
  if (!member || !lobby) return;

  const pendingKey = `${newState.guild.id}:${member.id}`;
  if (pendingMembers.has(pendingKey)) return;
  pendingMembers.add(pendingKey);

  let created: VoiceChannel | null = null;
  try {
    const categoryId = config.categoryId || lobby.parentId || undefined;

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

  if (action === "transfer") {
    const modal = new ModalBuilder().setCustomId(TRANSFER_MODAL_ID).setTitle("Transfer Channel Ownership");
    const input = new TextInputBuilder()
      .setCustomId(TRANSFER_INPUT_ID)
      .setLabel("Member name or @mention")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("@member or user id")
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
  "Usage: `!vc help` | `!vc <lock|unlock|hide|show|limit|name|transfer|permit|reject|kick|pull|claim|info>`";

export async function handleVcCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  const voice = message.member?.voice.channel;
  if (!guild || !voice || voice.type !== ChannelType.GuildVoice || !tempChannels.has(voice.id)) {
    await message.reply("You must be in a temporary voice channel.");
    return;
  }
  const channel: VoiceChannel = voice;

  const sub = args[0]?.toLowerCase() ?? "";
  const ownerId = tempChannels.get(channel.id);

  try {
    if (sub === "help" || sub === "usage") {
      await message.reply({
        content:
          "**Voice channel controls**\n" +
          "`!vc help` — show this help\n" +
          "`!vc lock` / `!vc unlock` — lock or unlock the channel\n" +
          "`!vc hide` / `!vc show` — hide or show the channel\n" +
          "`!vc limit <0-99>` — set the member limit\n" +
          "`!vc name <new name>` — rename the channel\n" +
          "`!vc transfer @user` — pass ownership to another member in the VC\n" +
          "`!vc permit @user` / `!vc reject @user` — allow or deny access\n" +
          "`!vc kick @user` / `!vc pull @user` — remove or pull a member into the VC\n" +
          "`!vc claim` / `!vc info` — claim ownership or view channel info",
      });
      return;
    }

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
      ["limit", "name", "transfer", "owner", "permit", "reject", "kick", "move", "pull"].includes(sub);
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

    if (sub === "transfer" || sub === "owner") {
      const target = message.mentions.members?.first();
      if (!target) {
        await message.reply("Mention a member in this channel to transfer ownership, e.g. `!vc transfer @user`.");
        return;
      }
      if (target.id === ownerId) {
        await message.reply("You are already the owner of this channel.");
        return;
      }
      if (target.voice.channelId !== channel.id) {
        await message.reply("That member must be in this voice channel to become the new owner.");
        return;
      }
      await transferOwnership(channel, target.id, message.author.id);
      tempChannels.set(channel.id, target.id);
      await message.reply(`👑 Ownership transferred to <@${target.id}>.`);
      return;
    }

    // Remaining subcommands all target a mentioned member.
    const target = message.mentions.members?.first();
    if (!target) {
      await message.reply(`Mention a member, e.g. \`!vc ${sub} @user\`.`);
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

const JTC_USAGE =
  "ℹ️ Usage: `!jtc set <#lobby-voice-channel> [#category]`, `!jtc remove`, or `!jtc status`.";
const NO_MENTIONS = { parse: [] as never[], repliedUser: false };

function parseChannelId(token: string): string | null {
  const match = /^<#(\d{17,20})>$/.exec(token) ?? /^(\d{17,20})$/.exec(token);
  return match?.[1] ?? null;
}

export async function handleJtcCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const reply = (content: string) =>
    message.reply({ content, allowedMentions: NO_MENTIONS });

  const member =
    message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
  if (
    !member?.permissions.has(PermissionFlagsBits.ManageGuild) &&
    !member?.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    await reply("❌ You need **Manage Server** permission to configure Join to Create.");
    return;
  }

  const sub = args[0]?.toLowerCase() ?? "";

  try {
    if (sub === "set") {
      const lobbyToken = args[1];
      if (!lobbyToken) {
        await reply("❌ Provide a lobby voice channel. " + JTC_USAGE);
        return;
      }
      const lobbyId = parseChannelId(lobbyToken);
      const lobby = lobbyId ? await guild.channels.fetch(lobbyId).catch(() => null) : null;
      if (!lobby || lobby.guildId !== guild.id) {
        await reply("❌ I couldn't find that channel in this server. Mention a voice channel from this server.");
        return;
      }
      if (lobby.type !== ChannelType.GuildVoice) {
        await reply("❌ The lobby must be a voice channel (not a stage, text channel, or category).");
        return;
      }

      let categoryId: string | null = null;
      if (args[2]) {
        const parsedCategoryId = parseChannelId(args[2]);
        const category = parsedCategoryId
          ? await guild.channels.fetch(parsedCategoryId).catch(() => null)
          : null;
        if (!category || category.guildId !== guild.id) {
          await reply("❌ I couldn't find that category in this server.");
          return;
        }
        if (category.type !== ChannelType.GuildCategory) {
          await reply("❌ The category must be a channel category.");
          return;
        }
        categoryId = category.id;
      }

      await setJtcConfig(guild.id, lobby.id, categoryId);
      await reply(
        `✅ Join to Create is on. Members who join <#${lobby.id}> get their own voice channel` +
          (categoryId ? ` in <#${categoryId}>.` : " in the lobby's category."),
      );
      return;
    }

    if (sub === "remove" || sub === "disable") {
      const removed = await removeJtcConfig(guild.id);
      const env = envJtcConfig();
      const envActive = env !== null && guild.channels.cache.has(env.lobbyId);
      if (envActive) {
        await reply(
          `${removed ? "✅ Server settings removed." : "ℹ️ No server settings were saved."} ` +
            `Join to Create is still active through the bot's default lobby <#${env.lobbyId}>.`,
        );
      } else {
        await reply(
          removed ? "✅ Join to Create is now off." : "ℹ️ Join to Create was not configured.",
        );
      }
      return;
    }

    if (sub === "status") {
      const config = await getJtcConfig(guild.id);
      if (!config || (config.source === "env" && !guild.channels.cache.has(config.lobbyId))) {
        await reply("ℹ️ Join to Create is off. Use `!jtc set <#lobby> [#category]` to turn it on.");
        return;
      }
      await reply(
        [
          "✨ Join to Create is on.",
          `Lobby: <#${config.lobbyId}>`,
          `Category: ${config.categoryId ? `<#${config.categoryId}>` : "same as the lobby"}`,
          config.source === "env" ? "Source: bot default (environment)" : "Source: server settings",
        ].join("\n"),
      );
      return;
    }

    await reply(JTC_USAGE);
  } catch (err) {
    logger.error({ err, guildId: guild.id, sub }, "Failed to run !jtc command");
    await reply("❌ Something went wrong running that command. Please try again.").catch(() => {});
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
  } else if (interaction.isModalSubmit() && interaction.customId === TRANSFER_MODAL_ID) {
    await handleJtcTransferSubmit(interaction);
  }
}

async function handleJtcTransferSubmit(interaction: ModalSubmitInteraction): Promise<void> {
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

  const raw = interaction.fields.getTextInputValue(TRANSFER_INPUT_ID).trim();
  const targetMember = raw
    ? (interaction.guild?.members.cache.get(raw.replace(/^<@!?|>$/g, "")) ??
        interaction.guild?.members.cache.find((member) => member.user.username.toLowerCase() === raw.toLowerCase() || member.user.tag.toLowerCase() === raw.toLowerCase()) ??
        null)
    : null;

  if (!targetMember) {
    await interaction.reply({
      content: "Mention a valid member in this channel or enter their user ID.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (targetMember.id === interaction.user.id) {
    await interaction.reply({
      content: "You are already the owner of this channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (targetMember.voice.channelId !== channel.id) {
    await interaction.reply({
      content: "That member must be in this voice channel to become the new owner.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await transferOwnership(channel, targetMember.id, interaction.user.id);
  tempChannels.set(channel.id, targetMember.id);
  await interaction.editReply({ content: `👑 Ownership transferred to <@${targetMember.id}>.` });
}

export async function handleVoiceStateUpdate(
  client: Client,
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  // Ignore events caused by the bot itself, and by other bots.
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot || member.id === client.user?.id) return;

  if (oldState.channelId === newState.channelId) return;

  // Guild config (set with !jtc) takes priority; env vars are the fallback.
  if (newState.channelId) {
    const config = await getJtcConfig(newState.guild.id);
    if (config && newState.channelId === config.lobbyId) {
      await createTempChannel(client, newState, config);
    }
  }

  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    await cleanupTempChannel(oldState);
  }
}
