import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type Message,
  type MessageReaction,
  type User,
} from "discord.js";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  botCrateSettingsTable,
  botExperienceBoostsTable,
  db,
} from "@workspace/db";
import { logger } from "../lib/logger";

const DEFAULT_INTERVAL_MINUTES = 30;
const MIN_INTERVAL_MINUTES = 10;
const MAX_INTERVAL_MINUTES = 24 * 60;
const CRATE_LIFETIME_MS = 10 * 60_000;
const SCHEDULER_INTERVAL_MS = 30_000;
const REACTION = "🦉";
const BOOST_PERCENT = 25;
const BOOST_DURATION_MS = 60 * 60_000;

let scheduler: NodeJS.Timeout | undefined;
let schedulerRunning = false;

function crateEmbed(expiresAt: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("A Mysterious Crate Has Appeared!")
    .setDescription(
      `<:click:1338116032237273108> **React** to this message with the emoji below to win!\n\n` +
      `<:reaction:1537503043417940109> **Reaction:** ${REACTION}\n` +
      "<:trophy:1479487961178575058> **First valid reaction wins!**\n\n" +
      "<:rare:1388718237975690> **Rarity:** Rare\n" +
      `<:boosters:1389543657136455772> **Reward:** ${BOOST_PERCENT}% XP Boost (**1h**)\n` +
      `<:time:1347194611575160923> **Expires:** <t:${Math.floor(expiresAt / 1000)}:R>`,
    )
    .setFooter({ text: "One winner • Good luck!" });
}

function parseInterval(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+)(m|h)$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const minutes = amount * (match[2]!.toLowerCase() === "h" ? 60 : 1);
  return Number.isInteger(minutes) &&
    minutes >= MIN_INTERVAL_MINUTES &&
    minutes <= MAX_INTERVAL_MINUTES
    ? minutes
    : null;
}

async function getCrateSettings(guildId: string) {
  const [settings] = await db
    .select()
    .from(botCrateSettingsTable)
    .where(eq(botCrateSettingsTable.guildId, guildId));
  return settings;
}

export async function handleCrateCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const member =
    message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need **Manage Server** permission to configure crate events.");
    return;
  }

  const [, action = "status", ...args] = message.content.trim().split(/\s+/);
  const normalizedAction = action.toLowerCase();
  try {
    if (normalizedAction === "status") {
      const settings = await getCrateSettings(guild.id);
      await message.reply(
        settings
          ? `**Crate event settings**\nChannel: <#${settings.channelId}>\nInterval: ${settings.intervalMinutes} minutes\nStatus: ${settings.enabled ? "enabled" : "paused"}\nNext crate: ${settings.enabled ? `<t:${Math.floor(settings.nextCrateAt / 1000)}:R>` : "paused"}\nActive crate: ${settings.activeMessageId ? `<#${settings.channelId}> (expires <t:${Math.floor((settings.activeExpiresAt ?? 0) / 1000)}:R>)` : "none"}\nTotal claimed: ${settings.totalCratesClaimed.toLocaleString()}`
          : "Crate events are not configured. Use `!crate setup #channel [30m]`.",
      );
      return;
    }

    if (normalizedAction === "setup") {
      const mentioned = message.mentions.channels.first();
      const channel = mentioned ? guild.channels.cache.get(mentioned.id) : undefined;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await message.reply("Usage: `!crate setup #text-channel [30m]`.");
        return;
      }
      const intervalArgument = args.find((argument) => argument !== `<#${channel.id}>`);
      const intervalMinutes = intervalArgument
        ? parseInterval(intervalArgument)
        : DEFAULT_INTERVAL_MINUTES;
      if (!intervalMinutes) {
        await message.reply(`❌ Interval must be ${MIN_INTERVAL_MINUTES}m–24h, for example \`30m\` or \`2h\`.`);
        return;
      }
      const existing = await getCrateSettings(guild.id);
      const now = Date.now();
      await db
        .insert(botCrateSettingsTable)
        .values({
          guildId: guild.id,
          channelId: channel.id,
          intervalMinutes,
          enabled: true,
          nextCrateAt: now + intervalMinutes * 60_000,
        })
        .onConflictDoUpdate({
          target: botCrateSettingsTable.guildId,
          set: {
            channelId: channel.id,
            intervalMinutes,
            enabled: true,
            nextCrateAt: existing?.activeMessageId
              ? existing.nextCrateAt
              : now + intervalMinutes * 60_000,
            updatedAt: new Date(now),
          },
        });
      await message.reply(
        `✅ Crate events are enabled in ${channel}, every ${intervalMinutes} minutes. The first crate appears after that interval.`,
      );
      return;
    }

    if (normalizedAction === "interval") {
      const intervalMinutes = parseInterval(args[0]);
      if (!intervalMinutes) {
        await message.reply(`Usage: \`!crate interval 30m\` (allowed: ${MIN_INTERVAL_MINUTES}m–24h).`);
        return;
      }
      const settings = await getCrateSettings(guild.id);
      if (!settings) {
        await message.reply("❌ Configure a channel first with `!crate setup #channel [30m]`.");
        return;
      }
      const now = Date.now();
      await db.update(botCrateSettingsTable)
        .set({
          intervalMinutes,
          nextCrateAt: settings.activeMessageId
            ? settings.nextCrateAt
            : now + intervalMinutes * 60_000,
          updatedAt: new Date(now),
        })
        .where(eq(botCrateSettingsTable.guildId, guild.id));
      await message.reply(`✅ Crate event interval set to ${intervalMinutes} minutes.`);
      return;
    }

    if (normalizedAction === "pause" || normalizedAction === "resume") {
      const enabled = normalizedAction === "resume";
      const settings = await getCrateSettings(guild.id);
      if (!settings) {
        await message.reply("❌ Configure a channel first with `!crate setup #channel [30m]`.");
        return;
      }
      await db.update(botCrateSettingsTable)
        .set({
          enabled,
          nextCrateAt: enabled
            ? Date.now() + settings.intervalMinutes * 60_000
            : settings.nextCrateAt,
          updatedAt: new Date(),
        })
        .where(eq(botCrateSettingsTable.guildId, guild.id));
      await message.reply(`✅ Crate events ${enabled ? "resumed" : "paused"}.`);
      return;
    }

    await message.reply("Usage: `!crate setup #channel [30m]`, `!crate interval 30m`, `!crate status`, `!crate pause`, or `!crate resume`.");
  } catch (error) {
    logger.error({ err: error, guildId: guild.id, action: normalizedAction }, "Crate settings command failed");
    await message.reply("❌ Could not update crate event settings. Please try again.");
  }
}

async function spawnCrate(
  client: Client,
  settings: typeof botCrateSettingsTable.$inferSelect,
): Promise<void> {
  const channel = await client.channels.fetch(settings.channelId);
  if (!channel || channel.type !== ChannelType.GuildText || !channel.isSendable()) {
    throw new Error(`Configured crate channel ${settings.channelId} is unavailable or not a text channel`);
  }
  const expiresAt = Date.now() + CRATE_LIFETIME_MS;
  const message = await channel.send({ embeds: [crateEmbed(expiresAt)] });
  try {
    await message.react(REACTION);
    await db.update(botCrateSettingsTable)
      .set({
        activeMessageId: message.id,
        activeBoostPercent: BOOST_PERCENT,
        activeExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(botCrateSettingsTable.guildId, settings.guildId));
  } catch (error) {
    await message.delete().catch(() => {});
    throw error;
  }
}

async function runScheduler(client: Client): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const settingsList = await db
      .select()
      .from(botCrateSettingsTable)
      .where(eq(botCrateSettingsTable.enabled, true));
    const now = Date.now();
    for (const settings of settingsList) {
      if (settings.activeMessageId && (settings.activeExpiresAt ?? 0) <= now) {
        await db.update(botCrateSettingsTable)
          .set({
            activeMessageId: null,
            activeBoostPercent: null,
            activeExpiresAt: null,
            updatedAt: new Date(now),
          })
          .where(and(
            eq(botCrateSettingsTable.guildId, settings.guildId),
            eq(botCrateSettingsTable.activeMessageId, settings.activeMessageId),
          ));
      }
      if (settings.activeMessageId || settings.nextCrateAt > now) continue;

      const nextCrateAt = now + settings.intervalMinutes * 60_000;
      const [claimed] = await db.update(botCrateSettingsTable)
        .set({ nextCrateAt, updatedAt: new Date(now) })
        .where(and(
          eq(botCrateSettingsTable.guildId, settings.guildId),
          eq(botCrateSettingsTable.enabled, true),
          eq(botCrateSettingsTable.nextCrateAt, settings.nextCrateAt),
          isNull(botCrateSettingsTable.activeMessageId),
        ))
        .returning({ guildId: botCrateSettingsTable.guildId });
      if (!claimed) continue;

      try {
        await spawnCrate(client, settings);
      } catch (error) {
        logger.error({ err: error, guildId: settings.guildId, channelId: settings.channelId }, "Could not spawn scheduled crate");
      }
    }
  } finally {
    schedulerRunning = false;
  }
}

export function startCrateScheduler(client: Client): void {
  if (scheduler) return;
  scheduler = setInterval(() => {
    void runScheduler(client).catch((error: unknown) => {
      logger.error({ err: error }, "Crate event scheduler failed");
    });
  }, SCHEDULER_INTERVAL_MS);
  scheduler.unref();
  void runScheduler(client).catch((error: unknown) => {
    logger.error({ err: error }, "Initial crate event scheduler run failed");
  });
}

export async function handleCrateReaction(reaction: MessageReaction, user: User): Promise<void> {
  if (user.bot || reaction.emoji.name !== REACTION) return;
  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();
  if (!reaction.message.guild) return;

  const now = Date.now();
  const result = await db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(botCrateSettingsTable)
      .where(and(
        eq(botCrateSettingsTable.guildId, reaction.message.guild!.id),
        eq(botCrateSettingsTable.activeMessageId, reaction.message.id),
        isNotNull(botCrateSettingsTable.activeMessageId),
      ))
      .for("update");
    if (
      !settings ||
      !settings.activeBoostPercent ||
      !settings.activeExpiresAt ||
      settings.activeExpiresAt <= now
    ) {
      return null;
    }

    await tx.insert(botExperienceBoostsTable)
      .values({
        guildId: settings.guildId,
        userId: user.id,
        source: "crate",
        boostPercent: settings.activeBoostPercent,
        expiresAt: now,
      })
      .onConflictDoNothing();
    const [existingBoost] = await tx.select().from(botExperienceBoostsTable)
      .where(and(
        eq(botExperienceBoostsTable.guildId, settings.guildId),
        eq(botExperienceBoostsTable.userId, user.id),
        eq(botExperienceBoostsTable.source, "crate"),
      ))
      .for("update");
    const boostUntil = Math.max(now, existingBoost?.expiresAt ?? 0) + BOOST_DURATION_MS;
    await tx.insert(botExperienceBoostsTable)
      .values({
        guildId: settings.guildId,
        userId: user.id,
        source: "crate",
        boostPercent: settings.activeBoostPercent,
        expiresAt: boostUntil,
      })
      .onConflictDoUpdate({
        target: [
          botExperienceBoostsTable.guildId,
          botExperienceBoostsTable.userId,
          botExperienceBoostsTable.source,
        ],
        set: {
          boostPercent: settings.activeBoostPercent,
          expiresAt: boostUntil,
          updatedAt: new Date(now),
        },
      });
    const totalCratesClaimed = settings.totalCratesClaimed + 1;
    await tx.update(botCrateSettingsTable)
      .set({
        activeMessageId: null,
        activeBoostPercent: null,
        activeExpiresAt: null,
        totalCratesClaimed,
        updatedAt: new Date(now),
      })
      .where(eq(botCrateSettingsTable.guildId, settings.guildId));
    return { boostUntil, totalCratesClaimed };
  });

  if (!result) return;
  const displayName = (reaction.message.guild.members.cache.get(user.id)?.displayName ?? user.globalName ?? user.username)
    .replace(/@/g, "@\u200b");
  try {
    await reaction.message.reply({
      content: `🎉 <@${user.id}> was first! You won a **${BOOST_PERCENT}% XP Boost** for **1 hour** from the Mysterious Crate.`,
      allowedMentions: { users: [user.id] },
    });
    await reaction.message.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle("Mysterious Crate Claimed!")
          .setDescription(
            `Congratulations ${displayName}! <:rare:1388718237975690> <@${user.id}> received ` +
            `<:boosters:1389543657136455772> **${BOOST_PERCENT}% XP Boost** (**1h**)!\n\n` +
            `<a:gift:1386036054909517924> Total Crates Claimed: **\`${result.totalCratesClaimed.toLocaleString()}\`**\n\n` +
            "Check your boosters with `!boosters`.",
          )
          .setTimestamp(),
      ],
      allowedMentions: { users: [user.id] },
    });
  } catch (error) {
    logger.error(
      { err: error, guildId: reaction.message.guild.id, userId: user.id, messageId: reaction.message.id },
      "Could not announce crate winner",
    );
  }
}
