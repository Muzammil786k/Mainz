import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type GuildMember,
  type Message,
  type MessageCreateOptions,
  type VoiceState,
} from "discord.js";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import {
  botExperiencePreferencesTable,
  botExperienceBoostsTable,
  botExperienceSettingsTable,
  botExperienceTable,
  botLevelRolesTable,
  botMiningProfilesTable,
  db,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { premiumColors } from "./presentation";

const XP_PER_LEVEL = 100;
const CHAT_XP_COOLDOWN_MS = 60_000;
const VOICE_XP_INTERVAL_MS = 60_000;
const MIN_CHAT_XP = 15;
const MAX_CHAT_XP = 25;
const VOICE_XP = 10;

interface AwardResult {
  amount: number;
  totalXp: number;
  level: number;
  levelsGained: number;
}

type LevelUpSender = (payload: MessageCreateOptions) => Promise<unknown>;

interface ExperienceSettings {
  levelUpChannelId: string | null;
  embedTitle: string | null;
  embedDescription: string | null;
  embedColor: string | null;
  allowedChatChannelIds: string[];
}

const DEFAULT_LEVEL_UP_TITLE = "🎉 New Level Gained!";
const DEFAULT_LEVEL_UP_DESCRIPTION =
  "✨ {user} leveled up **{levels_gained}** to **Level {level}**!";
const DEFAULT_LEVEL_UP_COLOR = premiumColors.success;
const LEVEL_UP_PLACEHOLDERS =
  "`{user}`, `{username}`, `{level}`, `{levels_gained}`, `{xp}`, `{total_xp}`, `{progress}`, `{next_level_xp}`";

const chatCooldowns = new Map<string, number>();
const chatChannelAllowlistCache = new Map<string, { channelIds: string[]; expiresAt: number }>();
const voiceJoinedAt = new Map<string, number>();
let voiceXpTimer: NodeJS.Timeout | undefined;
let voiceXpTickRunning = false;
const CHAT_CHANNEL_ALLOWLIST_CACHE_TTL_MS = 60_000;

function profileKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

async function awardXp(
  guildId: string,
  userId: string,
  amount: number,
  activity: "chat" | "voice",
): Promise<AwardResult | null> {
  const now = Date.now();
  return db.transaction(async (tx) => {
    await tx
      .insert(botExperienceTable)
      .values({ guildId, userId })
      .onConflictDoNothing();

    const [profile] = await tx
      .select()
      .from(botExperienceTable)
      .where(and(
        eq(botExperienceTable.guildId, guildId),
        eq(botExperienceTable.userId, userId),
      ))
      .for("update");
    if (!profile) throw new Error("Could not load experience profile after insert");

    const lastAwardAt = activity === "chat" ? profile.lastChatXpAt : profile.lastVoiceXpAt;
    const cooldown = activity === "chat" ? CHAT_XP_COOLDOWN_MS : VOICE_XP_INTERVAL_MS;
    if (now - lastAwardAt < cooldown) return null;

    const activeBoosts = await tx
      .select({ boostPercent: botExperienceBoostsTable.boostPercent })
      .from(botExperienceBoostsTable)
      .where(and(
        eq(botExperienceBoostsTable.guildId, guildId),
        eq(botExperienceBoostsTable.userId, userId),
        gte(botExperienceBoostsTable.expiresAt, now + 1),
      ));
    const totalBoostPercent = activeBoosts.reduce((total, boost) => total + boost.boostPercent, 0);
    const awardedAmount = Math.ceil(amount * (100 + totalBoostPercent) / 100);
    const totalXp = profile.totalXp + awardedAmount;
    const level = Math.floor(totalXp / XP_PER_LEVEL) + 1;
    await tx
      .update(botExperienceTable)
      .set({
        totalXp,
        level,
        ...(activity === "chat" ? { lastChatXpAt: now } : { lastVoiceXpAt: now }),
        updatedAt: new Date(now),
      })
      .where(and(
        eq(botExperienceTable.guildId, guildId),
        eq(botExperienceTable.userId, userId),
      ));

    return {
      amount: awardedAmount,
      totalXp,
      level,
      levelsGained: level - profile.level,
    };
  });
}

async function getExperienceSettings(guildId: string): Promise<ExperienceSettings> {
  const [settings] = await db
    .select()
    .from(botExperienceSettingsTable)
    .where(eq(botExperienceSettingsTable.guildId, guildId));
  return {
    levelUpChannelId: settings?.levelUpChannelId ?? null,
    embedTitle: settings?.embedTitle ?? null,
    embedDescription: settings?.embedDescription ?? null,
    embedColor: settings?.embedColor ?? null,
    allowedChatChannelIds: settings?.allowedChatChannelIds ?? [],
  };
}

async function getAllowedChatChannelIds(guildId: string): Promise<string[]> {
  const now = Date.now();
  const cached = chatChannelAllowlistCache.get(guildId);
  if (cached && cached.expiresAt > now) return cached.channelIds;

  const [settings] = await db
    .select({ channelIds: botExperienceSettingsTable.allowedChatChannelIds })
    .from(botExperienceSettingsTable)
    .where(eq(botExperienceSettingsTable.guildId, guildId));
  const channelIds = settings?.channelIds ?? [];
  chatChannelAllowlistCache.set(guildId, {
    channelIds,
    expiresAt: now + CHAT_CHANNEL_ALLOWLIST_CACHE_TTL_MS,
  });
  return channelIds;
}

function interpolateTemplate(
  template: string,
  member: GuildMember,
  result: AwardResult,
): string {
  const progress = result.totalXp % XP_PER_LEVEL;
  const values: Record<string, string> = {
    user: `<@${member.id}>`,
    username: member.displayName,
    level: String(result.level),
    levels_gained: String(result.levelsGained),
    xp: String(result.amount),
    total_xp: String(result.totalXp),
    progress: String(progress),
    next_level_xp: String(XP_PER_LEVEL - progress),
  };
  return template.replace(/\{([a-z_]+)\}/gi, (placeholder, key: string) =>
    values[key.toLowerCase()] ?? placeholder,
  );
}

function buildLevelUpEmbed(
  member: GuildMember,
  result: AwardResult,
  settings: ExperienceSettings,
): EmbedBuilder {
  const progress = result.totalXp % XP_PER_LEVEL;
  const filled = Math.floor((progress / XP_PER_LEVEL) * 10);
  const meter = `${"▰".repeat(filled)}${"▱".repeat(10 - filled)}`;
  const title = interpolateTemplate(
    settings.embedTitle ?? DEFAULT_LEVEL_UP_TITLE,
    member,
    result,
  );
  const description = interpolateTemplate(
    settings.embedDescription ?? DEFAULT_LEVEL_UP_DESCRIPTION,
    member,
    result,
  );
  const color = settings.embedColor
    ? Number.parseInt(settings.embedColor.slice(1), 16)
    : DEFAULT_LEVEL_UP_COLOR;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      {
        name: "🌟 XP Earned",
        value: `**+${result.amount} XP** • ${result.totalXp.toLocaleString()} XP total`,
        inline: true,
      },
      {
        name: "📈 Next Level",
        value: `${progress}/${XP_PER_LEVEL} XP\n${meter}`,
        inline: true,
      },
    )
    .setThumbnail(member.displayAvatarURL({ size: 128 }))
    .setFooter({ text: "Stay active in chat and voice to keep earning XP." })
    .setTimestamp();
}

async function announceLevelUp(
  defaultSend: LevelUpSender,
  guildId: string,
  member: GuildMember,
  result: AwardResult,
): Promise<void> {
  if (result.levelsGained < 1) return;
  await awardLevelRoles(member, result);
  const settings = await getExperienceSettings(guildId);
  const [preferences] = await db
    .select()
    .from(botExperiencePreferencesTable)
    .where(and(
      eq(botExperiencePreferencesTable.guildId, guildId),
      eq(botExperiencePreferencesTable.userId, member.id),
    ));
  if ((preferences?.serverNotifications ?? true) === false && !preferences?.dmNotifications) return;

  let send = defaultSend;
  if (preferences?.serverNotifications && settings.levelUpChannelId) {
    const channel = await member.guild.channels.fetch(settings.levelUpChannelId);
    if (!channel || !channel.isSendable()) {
      throw new Error(`Configured level-up channel ${settings.levelUpChannelId} is unavailable`);
    }
    send = (payload) => channel.send(payload);
  }
  const embed = buildLevelUpEmbed(member, result, settings);
  if (preferences?.serverNotifications ?? true) {
    await send({
      embeds: [embed],
      allowedMentions: { users: [member.id] },
    });
  }
  if (preferences?.dmNotifications) {
    await member.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    }).catch((error: unknown) => {
      logger.warn(
        { err: error, guildId, userId: member.id },
        "Could not send level-up notification by DM",
      );
    });
  }
}

async function awardLevelRoles(member: GuildMember, result: AwardResult): Promise<void> {
  const firstNewLevel = result.level - result.levelsGained + 1;
  let mappings: (typeof botLevelRolesTable.$inferSelect)[];
  try {
    mappings = await db
      .select()
      .from(botLevelRolesTable)
      .where(and(
        eq(botLevelRolesTable.guildId, member.guild.id),
        gte(botLevelRolesTable.level, firstNewLevel),
        lte(botLevelRolesTable.level, result.level),
      ));
  } catch (error) {
    logger.error(
      { err: error, guildId: member.guild.id, userId: member.id },
      "Failed to load configured level roles",
    );
    return;
  }
  if (mappings.length === 0) return;

  const guildMember = member.guild.members.me;
  if (!guildMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    logger.error(
      { guildId: member.guild.id, userId: member.id },
      "Cannot grant configured level roles: bot is missing Manage Roles permission",
    );
    return;
  }

  for (const mapping of mappings) {
    const role = await member.guild.roles.fetch(mapping.roleId);
    if (!role) {
      logger.error(
        { guildId: member.guild.id, userId: member.id, level: mapping.level, roleId: mapping.roleId },
        "Configured level role no longer exists",
      );
      continue;
    }
    if (role.managed || guildMember.roles.highest.comparePositionTo(role) <= 0) {
      logger.error(
        { guildId: member.guild.id, userId: member.id, level: mapping.level, roleId: role.id },
        "Cannot grant configured level role because it is managed or above the bot",
      );
      continue;
    }
    if (member.roles.cache.has(role.id)) continue;
    try {
      await member.roles.add(role, `Reached level ${mapping.level}`);
    } catch (error) {
      logger.error(
        { err: error, guildId: member.guild.id, userId: member.id, level: mapping.level, roleId: role.id },
        "Failed to grant configured level role",
      );
    }
  }
}

async function saveExperienceSettings(
  guildId: string,
  updates: Partial<ExperienceSettings>,
): Promise<void> {
  await db
    .insert(botExperienceSettingsTable)
    .values({ guildId, ...updates })
    .onConflictDoUpdate({
      target: botExperienceSettingsTable.guildId,
      set: { ...updates, updatedAt: new Date() },
    });
  chatChannelAllowlistCache.delete(guildId);
}

export async function handleLevelUpCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const member =
    message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need **Manage Server** permission to change level-up settings.");
    return;
  }

  const [, action = "help", ...args] = message.content.trim().split(/\s+/);
  const value = args.join(" ").trim();
  const reset = value.toLowerCase() === "reset";
  const usage =
    "Usage: `!levelup channel #channel|reset`, `!levelup allow #channel`, `!levelup disallow #channel`, `!levelup allowed`, `!levelup clearallowed`, `!levelup role set <level> @role`, `!levelup role remove <level>`, `!levelup role list`, `!levelup title <text|reset>`, `!levelup description <text|reset>`, `!levelup color #RRGGBB|reset`, or `!levelup status`.";

  if (action.toLowerCase() === "role") {
    const [roleAction, rawLevel] = args;
    if (roleAction?.toLowerCase() === "list") {
      try {
        const mappings = await db
          .select()
          .from(botLevelRolesTable)
          .where(eq(botLevelRolesTable.guildId, guild.id))
          .orderBy(botLevelRolesTable.level);
        await message.reply({
          content: mappings.length
            ? `**Level roles**\n${mappings.map(({ level, roleId }) => `Level **${level}** → <@&${roleId}>`).join("\n")}`
            : "No level roles configured yet.",
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        logger.error({ err: error, guildId: guild.id }, "Failed to load level roles");
        await message.reply("❌ Could not load level roles. Please try again.");
      }
      return;
    }

    const level = Number(rawLevel);
    if (!Number.isInteger(level) || level < 2 || level > 100_000) {
      await message.reply(`❌ Level must be a whole number from 2 to 100,000. ${usage}`);
      return;
    }

    if (roleAction?.toLowerCase() === "remove") {
      try {
        const [removed] = await db
          .delete(botLevelRolesTable)
          .where(and(
            eq(botLevelRolesTable.guildId, guild.id),
            eq(botLevelRolesTable.level, level),
          ))
          .returning({ roleId: botLevelRolesTable.roleId });
        await message.reply(
          removed
            ? `✅ Removed the role reward for level ${level}. Members who already have that role keep it.`
            : `ℹ️ No role reward was configured for level ${level}.`,
        );
      } catch (error) {
        logger.error({ err: error, guildId: guild.id, level }, "Failed to remove level role");
        await message.reply("❌ Could not remove that level role. Please try again.");
      }
      return;
    }

    if (roleAction?.toLowerCase() !== "set") {
      await message.reply(usage);
      return;
    }
    const role = message.mentions.roles.first();
    const botMember = guild.members.me;
    if (!role) {
      await message.reply(`❌ Mention a role to assign. ${usage}`);
      return;
    }
    if (
      !botMember?.permissions.has(PermissionFlagsBits.ManageRoles) ||
      role.managed ||
      botMember.roles.highest.comparePositionTo(role) <= 0
    ) {
      await message.reply(
        "❌ I need **Manage Roles**, and my highest role must be above the selected role.",
      );
      return;
    }
    try {
      await db
        .insert(botLevelRolesTable)
        .values({ guildId: guild.id, level, roleId: role.id })
        .onConflictDoUpdate({
          target: [botLevelRolesTable.guildId, botLevelRolesTable.level],
          set: { roleId: role.id, updatedAt: new Date() },
        });
      await message.reply(`✅ Members will receive ${role} when they reach level ${level}.`);
    } catch (error) {
      logger.error({ err: error, guildId: guild.id, level, roleId: role.id }, "Failed to set level role");
      await message.reply("❌ Could not set that level role. Please try again.");
    }
    return;
  }

  if (action.toLowerCase() === "status" || action.toLowerCase() === "allowed") {
    try {
      const settings = await getExperienceSettings(guild.id);
      const allowedChannels = settings.allowedChatChannelIds;
      const channelSummary =
        allowedChannels.length === 0
          ? "all text channels"
          : `${allowedChannels.slice(0, 20).map((id) => `<#${id}>`).join(", ")}${allowedChannels.length > 20 ? `, and ${allowedChannels.length - 20} more` : ""}`;
      if (action.toLowerCase() === "allowed") {
        await message.reply({
          content: `Chat XP is enabled in: ${channelSummary}.`,
          allowedMentions: { parse: [] },
        });
        return;
      }
      await message.reply({
        content: `**Level-up settings**\nAnnouncement channel: ${settings.levelUpChannelId ? `<#${settings.levelUpChannelId}>` : "the channel where XP was earned"}\nChat XP channels: ${channelSummary}\nTitle: ${settings.embedTitle ? `${settings.embedTitle.slice(0, 200)}${settings.embedTitle.length > 200 ? "…" : ""}` : "default"}\nDescription: ${settings.embedDescription ? `${settings.embedDescription.slice(0, 600)}${settings.embedDescription.length > 600 ? "…" : ""}` : "default"}\nColor: ${settings.embedColor ?? "default"}\nLevel roles: use \`!levelup role list\` to view`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      logger.error({ err: error, guildId: guild.id }, "Failed to load level-up settings");
      await message.reply("❌ Could not load level-up settings. Please try again.");
    }
    return;
  }

  let updates: Partial<ExperienceSettings>;
  let confirmation: string;
  if (action.toLowerCase() === "channel") {
    if (reset) {
      updates = { levelUpChannelId: null };
      confirmation = "✅ Level-up announcements will be sent where XP was earned.";
    } else {
      const channel = message.mentions.channels.first();
      if (
        !channel ||
        (channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement)
      ) {
        await message.reply(`❌ Mention a server text channel or use \`reset\`. ${usage}`);
        return;
      }
      updates = { levelUpChannelId: channel.id };
      confirmation = `✅ Level-up announcements will be sent to ${channel}.`;
    }
  } else if (action.toLowerCase() === "title" || action.toLowerCase() === "description") {
    if (!reset && !value) {
      await message.reply(`❌ Provide text or use \`reset\`. ${usage}\nPlaceholders: ${LEVEL_UP_PLACEHOLDERS}`);
      return;
    }
    const setting = action.toLowerCase() === "title" ? "embedTitle" : "embedDescription";
    const maxLength = setting === "embedTitle" ? 256 : 4096;
    if (!reset && value.length > maxLength) {
      await message.reply(`❌ ${action} must be ${maxLength} characters or fewer.`);
      return;
    }
    updates = { [setting]: reset ? null : value };
    confirmation = `✅ Level-up embed ${action} ${reset ? "reset to default" : "updated"}.`;
  } else if (action.toLowerCase() === "color") {
    if (!reset && !/^#?[0-9a-f]{6}$/i.test(value)) {
      await message.reply(`❌ Use a six-digit hex color, for example \`#5865F2\`, or use \`reset\`.`);
      return;
    }
    updates = { embedColor: reset ? null : `#${value.replace(/^#/, "")}` };
    confirmation = `✅ Level-up embed color ${reset ? "reset to default" : "updated"}.`;
  } else if (
    action.toLowerCase() === "allow" ||
    action.toLowerCase() === "disallow"
  ) {
    const mentionedChannel = message.mentions.channels.first();
    const channel = mentionedChannel
      ? guild.channels.cache.get(mentionedChannel.id)
      : undefined;
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement)
    ) {
      await message.reply(`❌ Mention a text channel. ${usage}`);
      return;
    }
    let current: string[];
    try {
      current = await getAllowedChatChannelIds(guild.id);
    } catch (error) {
      logger.error({ err: error, guildId: guild.id, action }, "Failed to load allowed XP channels");
      await message.reply("❌ Could not load allowed XP channels. Please try again.");
      return;
    }
    if (action.toLowerCase() === "allow") {
      if (current.includes(channel.id)) {
        await message.reply(`ℹ️ Chat XP is already enabled in ${channel}.`);
        return;
      }
      updates = { allowedChatChannelIds: [...current, channel.id] };
      confirmation = `✅ Chat XP is now enabled in ${channel}.`;
    } else {
      if (!current.includes(channel.id)) {
        await message.reply(`ℹ️ Chat XP was not enabled specifically in ${channel}.`);
        return;
      }
      const remainingChannelIds = current.filter((id) => id !== channel.id);
      updates = { allowedChatChannelIds: remainingChannelIds };
      confirmation = `✅ Chat XP is no longer enabled in ${channel}.${remainingChannelIds.length === 0 ? " With no allowed channels remaining, chat XP is enabled in all text channels." : ""}`;
    }
  } else if (action.toLowerCase() === "clearallowed") {
    updates = { allowedChatChannelIds: [] };
    confirmation = "✅ Chat XP is enabled in all text channels.";
  } else {
    await message.reply(`${usage}\nPlaceholders: ${LEVEL_UP_PLACEHOLDERS}`);
    return;
  }

  try {
    await saveExperienceSettings(guild.id, updates);
    await message.reply(confirmation);
  } catch (error) {
    logger.error({ err: error, guildId: guild.id, action }, "Failed to save level-up settings");
    await message.reply("❌ Could not update level-up settings. Please try again.");
  }
}

type LevelProfileSection = "progress" | "credits" | "boosters" | "leaderboard";

function levelProfileComponents(
  userId: string,
  section: LevelProfileSection,
  serverNotifications: boolean,
  dmNotifications: boolean,
) {
  const firstRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`lvl:${userId}:progress`).setLabel("Progress").setStyle(section === "progress" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`lvl:${userId}:credits`).setLabel("Credits").setStyle(section === "credits" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`lvl:${userId}:boosters`).setLabel("Boosters").setStyle(section === "boosters" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`lvl:${userId}:leaderboard`).setLabel("Leaderboard").setStyle(section === "leaderboard" ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
  const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`lvl:${userId}:toggle-server`)
      .setLabel(`Server notifications: ${serverNotifications ? "On" : "Off"}`)
      .setStyle(serverNotifications ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`lvl:${userId}:toggle-dm`)
      .setLabel(`DM notifications: ${dmNotifications ? "On" : "Off"}`)
      .setStyle(dmNotifications ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  return [firstRow, secondRow];
}

async function getLevelProfilePayload(
  member: GuildMember,
  section: LevelProfileSection,
): Promise<{
  embeds: EmbedBuilder[];
  components: ReturnType<typeof levelProfileComponents>;
}> {
  const { guild, user } = member;
  const now = Date.now();
  const [profileRows, creditRows, activeBoosts, preferenceRows] = await Promise.all([
    db.select().from(botExperienceTable).where(and(
      eq(botExperienceTable.guildId, guild.id),
      eq(botExperienceTable.userId, user.id),
    )),
    db.select({ coins: botMiningProfilesTable.coins }).from(botMiningProfilesTable).where(and(
      eq(botMiningProfilesTable.guildId, guild.id),
      eq(botMiningProfilesTable.userId, user.id),
    )),
    db.select().from(botExperienceBoostsTable).where(and(
      eq(botExperienceBoostsTable.guildId, guild.id),
      eq(botExperienceBoostsTable.userId, user.id),
      gte(botExperienceBoostsTable.expiresAt, now + 1),
    )),
    db.select().from(botExperiencePreferencesTable).where(and(
      eq(botExperiencePreferencesTable.guildId, guild.id),
      eq(botExperiencePreferencesTable.userId, user.id),
    )),
  ]);
  const profile = profileRows[0];
  const totalXp = profile?.totalXp ?? 0;
  const level = profile?.level ?? 1;
  const progress = totalXp % XP_PER_LEVEL;
  const nextLevelXp = XP_PER_LEVEL - progress;
  const totalBoostPercent = activeBoosts.reduce((total, boost) => total + boost.boostPercent, 0);
  const activeBoost = activeBoosts.length > 0;
  const preferences = preferenceRows[0];
  const serverNotifications = preferences?.serverNotifications ?? true;
  const dmNotifications = preferences?.dmNotifications ?? false;
  const embed = new EmbedBuilder()
    .setColor(premiumColors.brand)
    .setAuthor({ name: `${member.displayName}'s Level Profile`, iconURL: member.displayAvatarURL() })
    .setTimestamp();

  if (section === "progress") {
    const milestoneRoles = await db
      .select()
      .from(botLevelRolesTable)
      .where(eq(botLevelRolesTable.guildId, guild.id))
      .orderBy(botLevelRolesTable.level);
    const meterFilled = Math.floor((progress / XP_PER_LEVEL) * 10);
    const meter = `${"▰".repeat(meterFilled)}${"▱".repeat(10 - meterFilled)}`;
    const milestoneLines = milestoneRoles.slice(0, 10).map(({ level: milestone, roleId }) =>
      `${level >= milestone ? "✅" : "🔒"} **Level ${milestone}** | <@&${roleId}>`,
    );
    embed
      .setTitle(`Level ${level}${activeBoost ? ` (${((100 + totalBoostPercent) / 100).toFixed(2)}x XP)` : ""}`)
      .setDescription(
        `**XP:** ${totalXp.toLocaleString()} total\n` +
        `**XP for next level:** ${nextLevelXp.toLocaleString()}\n` +
        `**Progress:** ${progress}/${XP_PER_LEVEL} XP\n${meter}\n\n` +
        `**Milestones**\n${milestoneLines.length ? milestoneLines.join("\n") : "No role milestones configured yet."}`,
      )
      .setFooter({ text: "Keep active in chat and voice to gain XP and reach milestones." });
  } else if (section === "credits") {
    embed
      .setTitle("Credits")
      .setDescription(`You have **${(creditRows[0]?.coins ?? 0).toLocaleString()}** credits in this server.`);
  } else if (section === "boosters") {
    embed
      .setTitle("XP Boosters")
      .setDescription(
        activeBoost
          ? `**Activated**\n${activeBoosts.map((boost) =>
              `- **${boost.boostPercent}%** XP Boost • ${boost.source === "vote" ? "Vote reward" : "Mysterious Crate"} • Active until <t:${Math.floor(boost.expiresAt / 1000)}:R>`,
            ).join("\n")}`
          : "**Activated**\nNone\n\nVote on Top.gg or Discadia to activate a 20% XP boost for 12 hours.",
      );
  } else {
    const leaders = await db
      .select({ userId: botExperienceTable.userId, totalXp: botExperienceTable.totalXp, level: botExperienceTable.level })
      .from(botExperienceTable)
      .where(eq(botExperienceTable.guildId, guild.id))
      .orderBy(desc(botExperienceTable.totalXp))
      .limit(10);
    embed
      .setTitle("Server XP Leaderboard")
      .setDescription(
        leaders.length
          ? leaders.map((entry, index) =>
              `**${index + 1}.** <@${entry.userId}> — Level **${entry.level}** · ${entry.totalXp.toLocaleString()} XP`,
            ).join("\n")
          : "No one has earned XP yet.",
      )
      .setFooter({ text: "Leaderboard shows the top 10 members in this server." });
  }

  return {
    embeds: [embed],
    components: levelProfileComponents(user.id, section, serverNotifications, dmNotifications),
  };
}

export async function handleBoostersCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  try {
    const now = Date.now();
    const activeBoosts = await db.select().from(botExperienceBoostsTable).where(and(
      eq(botExperienceBoostsTable.guildId, guild.id),
      eq(botExperienceBoostsTable.userId, message.author.id),
      gte(botExperienceBoostsTable.expiresAt, now + 1),
    ));
    const embed = new EmbedBuilder()
      .setColor(premiumColors.brand)
      .setTitle("XP Boosters")
      .setDescription(
        activeBoosts.length
          ? `**Activated**\n${activeBoosts.map((boost) =>
              `- **${boost.boostPercent}%** XP Boost • ${boost.source === "vote" ? "Vote reward" : "Mysterious Crate"} • Active until <t:${Math.floor(boost.expiresAt / 1000)}:R>`,
            ).join("\n")}`
          : "**Activated**\nNone\n\nWin a Mysterious Crate or vote for the server to activate an XP boost.",
      )
      .setFooter({ text: "Active boosts stack and apply to chat and voice XP in this server." });
    await message.reply({ embeds: [embed] });
  } catch (error) {
    logger.error(
      { err: error, guildId: guild.id, userId: message.author.id },
      "Failed to load XP boosters",
    );
    await message.reply("❌ Could not load your boosters. Please try again.");
  }
}

export async function handleLevelProfileCommand(message: Message): Promise<void> {
  if (!message.guild) return;
  try {
    const member = message.member ?? await message.guild.members.fetch(message.author.id);
    const payload = await getLevelProfilePayload(member, "progress");
    const panel = await message.reply(payload);
    const collector = panel.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 10 * 60_000,
    });

    collector.on("collect", async (interaction) => {
      const [customId, ownerId, action] = interaction.customId.split(":");
      if (customId !== "lvl" || ownerId !== message.author.id) {
        await interaction.reply({
          content: "Only the person who opened this level panel can use it.",
          ephemeral: true,
        });
        return;
      }
      try {
        if (action === "toggle-server" || action === "toggle-dm") {
          await toggleLevelNotification(message.guild!.id, message.author.id, action);
        }
        const section: LevelProfileSection =
          action === "credits" || action === "boosters" || action === "leaderboard"
            ? action
            : "progress";
        await interaction.update(await getLevelProfilePayload(member, section));
      } catch (error) {
        logger.error(
          { err: error, guildId: message.guild?.id, userId: message.author.id, action },
          "Failed to update level profile panel",
        );
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Could not load that level panel. Please try again.", ephemeral: true });
        }
      }
    });
    collector.on("end", () => {
      void panel.edit({ components: [] }).catch((error: unknown) => {
        logger.warn({ err: error, guildId: message.guild?.id }, "Could not close expired level panel");
      });
    });
  } catch (error) {
    logger.error({ err: error, guildId: message.guild.id, userId: message.author.id }, "Failed to load level profile");
    await message.reply("❌ Could not load your level profile. Please try again.");
  }
}

async function toggleLevelNotification(
  guildId: string,
  userId: string,
  kind: "toggle-server" | "toggle-dm",
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(botExperiencePreferencesTable)
      .values({ guildId, userId })
      .onConflictDoNothing();
    const [preference] = await tx
      .select()
      .from(botExperiencePreferencesTable)
      .where(and(
        eq(botExperiencePreferencesTable.guildId, guildId),
        eq(botExperiencePreferencesTable.userId, userId),
      ))
      .for("update");
    if (!preference) throw new Error("Could not load level notification preferences");
    await tx
      .update(botExperiencePreferencesTable)
      .set({
        ...(kind === "toggle-server"
          ? { serverNotifications: !preference.serverNotifications }
          : { dmNotifications: !preference.dmNotifications }),
        updatedAt: new Date(),
      })
      .where(and(
        eq(botExperiencePreferencesTable.guildId, guildId),
        eq(botExperiencePreferencesTable.userId, userId),
      ));
  });
}

export async function awardChatXp(message: Message): Promise<void> {
  if (
    !message.guild ||
    message.author.bot ||
    !message.content.trim() ||
    message.content.trim().startsWith("!")
  ) return;

  const allowedChannelIds = await getAllowedChatChannelIds(message.guild.id);
  if (allowedChannelIds.length > 0 && !allowedChannelIds.includes(message.channel.id)) return;

  const key = profileKey(message.guild.id, message.author.id);
  const now = Date.now();
  if (now - (chatCooldowns.get(key) ?? 0) < CHAT_XP_COOLDOWN_MS) return;

  const amount = MIN_CHAT_XP + Math.floor(Math.random() * (MAX_CHAT_XP - MIN_CHAT_XP + 1));
  const result = await awardXp(message.guild.id, message.author.id, amount, "chat");
  if (!result) return;
  chatCooldowns.set(key, now);

  const member = message.member ?? await message.guild.members.fetch(message.author.id);
  const channel = message.channel;
  if (channel.isSendable()) {
    await announceLevelUp((payload) => channel.send(payload), message.guild.id, member, result);
  } else if (result.levelsGained > 0) {
    logger.warn(
      { guildId: message.guild.id, channelId: channel.id, userId: member.id },
      "Cannot send level-up announcement in this channel",
    );
  }
}

function voiceEligible(member: GuildMember): boolean {
  const channel = member.voice.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) return false;
  if (member.guild.afkChannelId === channel.id) return false;
  if (member.voice.selfDeaf || member.voice.serverDeaf) return false;
  const activeMembers = channel.members.filter(
    (voiceMember) =>
      !voiceMember.user.bot &&
      !voiceMember.voice.selfDeaf &&
      !voiceMember.voice.serverDeaf,
  );
  return activeMembers.size >= 2;
}

function refreshVoiceEligibility(channel: VoiceState["channel"]): void {
  if (!channel || channel.type !== ChannelType.GuildVoice) return;
  const now = Date.now();
  for (const member of channel.members.values()) {
    const key = profileKey(member.guild.id, member.id);
    if (voiceEligible(member)) {
      if (!voiceJoinedAt.has(key)) voiceJoinedAt.set(key, now);
    } else {
      voiceJoinedAt.delete(key);
    }
  }
}

async function awardVoiceXpForMember(member: GuildMember): Promise<void> {
  const key = profileKey(member.guild.id, member.id);
  const enteredAt = voiceJoinedAt.get(key);
  if (!enteredAt || Date.now() - enteredAt < VOICE_XP_INTERVAL_MS || !voiceEligible(member)) return;

  const result = await awardXp(member.guild.id, member.id, VOICE_XP, "voice");
  if (!result) return;

  const channel = member.voice.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) return;
  await announceLevelUp((payload) => channel.send(payload), member.guild.id, member, result);
}

async function awardVoiceXp(client: Client): Promise<void> {
  if (voiceXpTickRunning) return;
  voiceXpTickRunning = true;
  try {
    for (const guild of client.guilds.cache.values()) {
      for (const state of guild.voiceStates.cache.values()) {
        const member = state.member;
        if (!member || member.user.bot) continue;
        const key = profileKey(guild.id, member.id);
        if (!voiceEligible(member)) {
          voiceJoinedAt.delete(key);
          continue;
        }
        if (!voiceJoinedAt.has(key)) {
          voiceJoinedAt.set(key, Date.now());
          continue;
        }
        try {
          await awardVoiceXpForMember(member);
        } catch (err) {
          logger.error(
            { err, guildId: guild.id, userId: member.id },
            "Failed to award voice XP to member",
          );
        }
      }
    }
  } finally {
    voiceXpTickRunning = false;
  }
}

export function trackVoiceXpState(oldState: VoiceState, newState: VoiceState): void {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;
  refreshVoiceEligibility(oldState.channel);
  if (newState.channelId !== oldState.channelId) refreshVoiceEligibility(newState.channel);
}

export function startVoiceXp(client: Client): void {
  if (voiceXpTimer) return;

  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      const member = state.member;
      if (member && !member.user.bot && voiceEligible(member)) {
        voiceJoinedAt.set(profileKey(guild.id, member.id), now);
      }
    }
  }

  voiceXpTimer = setInterval(() => {
    void awardVoiceXp(client).catch((err: unknown) => {
      logger.error({ err }, "Failed to award voice XP");
    });
  }, VOICE_XP_INTERVAL_MS);
  voiceXpTimer.unref();
}
