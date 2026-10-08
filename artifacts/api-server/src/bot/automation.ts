import { and, eq } from "drizzle-orm";
import type { Client, GuildMember, Message, PartialGuildMember } from "discord.js";
import { db, botChannelAutomationsTable, botGuildMessagesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { premiumColors, premiumEmbed } from "./presentation";

const SETTINGS_CACHE_MS = 15_000;
const MAX_STICKY_CONTENT_LENGTH = 1_500;
const channelSettingsCache = new Map<
  string,
  { expiresAt: number; value: typeof botChannelAutomationsTable.$inferSelect | null }
>();
const stickyQueues = new Map<string, Promise<void>>();

function cacheKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

export async function getChannelAutomationSettings(guildId: string, channelId: string) {
  const key = cacheKey(guildId, channelId);
  const cached = channelSettingsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [settings] = await db
    .select()
    .from(botChannelAutomationsTable)
    .where(
      and(
        eq(botChannelAutomationsTable.guildId, guildId),
        eq(botChannelAutomationsTable.channelId, channelId),
      ),
    )
    .limit(1);

  const value = settings ?? null;
  channelSettingsCache.set(key, { value, expiresAt: Date.now() + SETTINGS_CACHE_MS });
  return value;
}

function invalidateChannelSettings(guildId: string, channelId: string): void {
  channelSettingsCache.delete(cacheKey(guildId, channelId));
}

export async function setChannelAutoReact(
  guildId: string,
  channelId: string,
  emoji: string,
): Promise<void> {
  await db
    .insert(botChannelAutomationsTable)
    .values({ guildId, channelId, autoReactEmoji: emoji })
    .onConflictDoUpdate({
      target: [botChannelAutomationsTable.guildId, botChannelAutomationsTable.channelId],
      set: { autoReactEmoji: emoji, updatedAt: new Date() },
    });
  invalidateChannelSettings(guildId, channelId);
}

export async function removeChannelAutoReact(
  guildId: string,
  channelId: string,
): Promise<boolean> {
  const settings = await getChannelAutomationSettings(guildId, channelId);
  if (!settings?.autoReactEmoji) return false;

  if (!settings.stickyContent) {
    await db
      .delete(botChannelAutomationsTable)
      .where(
        and(
          eq(botChannelAutomationsTable.guildId, guildId),
          eq(botChannelAutomationsTable.channelId, channelId),
        ),
      );
  } else {
    await db
      .update(botChannelAutomationsTable)
      .set({ autoReactEmoji: null, updatedAt: new Date() })
      .where(
        and(
          eq(botChannelAutomationsTable.guildId, guildId),
          eq(botChannelAutomationsTable.channelId, channelId),
        ),
      );
  }
  invalidateChannelSettings(guildId, channelId);
  return true;
}

export async function setChannelSticky(
  guildId: string,
  channelId: string,
  content: string,
): Promise<void> {
  await db
    .insert(botChannelAutomationsTable)
    .values({ guildId, channelId, stickyContent: content })
    .onConflictDoUpdate({
      target: [botChannelAutomationsTable.guildId, botChannelAutomationsTable.channelId],
      set: { stickyContent: content, updatedAt: new Date() },
    });
  invalidateChannelSettings(guildId, channelId);
}

export async function removeChannelSticky(
  guildId: string,
  channelId: string,
): Promise<{ removed: boolean; messageId: string | null }> {
  const settings = await getChannelAutomationSettings(guildId, channelId);
  if (!settings?.stickyContent) return { removed: false, messageId: null };

  if (!settings.autoReactEmoji) {
    await db
      .delete(botChannelAutomationsTable)
      .where(
        and(
          eq(botChannelAutomationsTable.guildId, guildId),
          eq(botChannelAutomationsTable.channelId, channelId),
        ),
      );
  } else {
    await db
      .update(botChannelAutomationsTable)
      .set({ stickyContent: null, stickyMessageId: null, updatedAt: new Date() })
      .where(
        and(
          eq(botChannelAutomationsTable.guildId, guildId),
          eq(botChannelAutomationsTable.channelId, channelId),
        ),
      );
  }
  invalidateChannelSettings(guildId, channelId);
  return { removed: true, messageId: settings.stickyMessageId };
}

export async function setGuildMessage(
  guildId: string,
  kind: "welcome" | "goodbye",
  channelId: string,
  template: string,
): Promise<void> {
  const channelField = kind === "welcome" ? "welcomeChannelId" : "goodbyeChannelId";
  const templateField = kind === "welcome" ? "welcomeTemplate" : "goodbyeTemplate";
  await db
    .insert(botGuildMessagesTable)
    .values({
      guildId,
      [channelField]: channelId,
      [templateField]: template,
    })
    .onConflictDoUpdate({
      target: botGuildMessagesTable.guildId,
      set: {
        [channelField]: channelId,
        [templateField]: template,
        updatedAt: new Date(),
      },
    });
}

export async function removeGuildMessage(
  guildId: string,
  kind: "welcome" | "goodbye",
): Promise<boolean> {
  const [settings] = await db
    .select()
    .from(botGuildMessagesTable)
    .where(eq(botGuildMessagesTable.guildId, guildId))
    .limit(1);
  if (!settings) return false;

  const channelId =
    kind === "welcome" ? settings.welcomeChannelId : settings.goodbyeChannelId;
  const template =
    kind === "welcome" ? settings.welcomeTemplate : settings.goodbyeTemplate;
  if (!channelId && !template) return false;

  const otherChannelId =
    kind === "welcome" ? settings.goodbyeChannelId : settings.welcomeChannelId;
  const otherTemplate =
    kind === "welcome" ? settings.goodbyeTemplate : settings.welcomeTemplate;

  if (!otherChannelId && !otherTemplate) {
    await db
      .delete(botGuildMessagesTable)
      .where(eq(botGuildMessagesTable.guildId, guildId));
  } else {
    await db
      .update(botGuildMessagesTable)
      .set(
        kind === "welcome"
          ? {
              welcomeChannelId: null,
              welcomeTemplate: null,
              updatedAt: new Date(),
            }
          : {
              goodbyeChannelId: null,
              goodbyeTemplate: null,
              updatedAt: new Date(),
            },
      )
      .where(eq(botGuildMessagesTable.guildId, guildId));
  }
  return true;
}

async function getTextChannel(client: Client, guildId: string, channelId: string) {
  const cachedGuildChannel = client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
  const channel =
    cachedGuildChannel ??
    (await client.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased() || !("guildId" in channel) || channel.guildId !== guildId) {
    return null;
  }
  return channel;
}

async function bumpStickyMessage(
  client: Client,
  guildId: string,
  channelId: string,
): Promise<void> {
  const settings = await getChannelAutomationSettings(guildId, channelId);
  if (!settings?.stickyContent) return;
  const channel = await getTextChannel(client, guildId, channelId);
  if (!channel) return;

  if (settings.stickyMessageId) {
    const previous = await channel.messages.fetch(settings.stickyMessageId).catch(() => null);
    if (previous && previous.author.id === client.user?.id) {
      try {
        await previous.delete();
      } catch (error) {
        logger.warn(
          { err: error, guildId, channelId },
          "Could not move the sticky message; check the bot's channel permissions",
        );
        return;
      }
    }
  }

  const sent = await channel.send({
    embeds: [
      premiumEmbed(
        settings.stickyContent,
        { title: "📌 Sticky message", color: premiumColors.brand },
        client.user,
      ),
    ],
    allowedMentions: { parse: [] },
  });

  await db
    .update(botChannelAutomationsTable)
    .set({ stickyMessageId: sent.id, updatedAt: new Date() })
    .where(
      and(
        eq(botChannelAutomationsTable.guildId, guildId),
        eq(botChannelAutomationsTable.channelId, channelId),
      ),
    );
  invalidateChannelSettings(guildId, channelId);
}

export async function bumpStickyForChannel(
  client: Client,
  guildId: string,
  channelId: string,
): Promise<void> {
  const key = cacheKey(guildId, channelId);
  const previous = stickyQueues.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => bumpStickyMessage(client, guildId, channelId))
    .catch((error: unknown) => {
      logger.warn({ err: error, guildId, channelId }, "Sticky message update failed");
    });
  stickyQueues.set(key, current);
  await current;
  if (stickyQueues.get(key) === current) stickyQueues.delete(key);
}

export async function processUserMessageAutomations(
  client: Client,
  message: Message,
): Promise<void> {
  if (!message.guild || message.author.bot || message.webhookId) return;

  try {
    const settings = await getChannelAutomationSettings(
      message.guild.id,
      message.channelId,
    );
    if (!settings) return;

    if (settings.autoReactEmoji) {
      await message.react(settings.autoReactEmoji).catch((error: unknown) => {
        logger.warn(
          { err: error, guildId: message.guildId, channelId: message.channelId },
          "Auto-react failed",
        );
      });
    }

    if (settings.stickyContent) {
      await bumpStickyForChannel(client, message.guild.id, message.channelId);
    }
  } catch (error) {
    logger.error(
      { err: error, guildId: message.guild.id, channelId: message.channelId },
      "Could not load channel automation settings",
    );
  }
}

function renderMemberTemplate(
  template: string,
  member: GuildMember | PartialGuildMember,
): string {
  return template
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{server}", member.guild.name)
    .replaceAll("{memberCount}", String(member.guild.memberCount))
    .slice(0, 4096);
}

export async function sendMemberMessage(
  client: Client,
  member: GuildMember | PartialGuildMember,
  kind: "welcome" | "goodbye",
): Promise<void> {
  const [settings] = await db
    .select()
    .from(botGuildMessagesTable)
    .where(eq(botGuildMessagesTable.guildId, member.guild.id))
    .limit(1);
  if (!settings) return;

  const channelId =
    kind === "welcome" ? settings.welcomeChannelId : settings.goodbyeChannelId;
  const template =
    kind === "welcome" ? settings.welcomeTemplate : settings.goodbyeTemplate;
  if (!channelId || !template) return;

  const channel = await getTextChannel(client, member.guild.id, channelId);
  if (!channel) {
    logger.warn(
      { guildId: member.guild.id, channelId },
      `${kind} message channel is unavailable`,
    );
    return;
  }

  const title =
    kind === "welcome"
      ? `Welcome to ${member.guild.name}`
      : `Goodbye from ${member.guild.name}`;
  await channel.send({
    embeds: [
      premiumEmbed(
        renderMemberTemplate(template, member),
        {
          title,
          thumbnail: member.user.displayAvatarURL({ size: 256 }),
          color: kind === "welcome" ? premiumColors.success : premiumColors.warning,
        },
        client.user,
      ),
    ],
    allowedMentions: { parse: [], users: [member.id] },
  });
}

export const automationLimits = {
  maxStickyContentLength: MAX_STICKY_CONTENT_LENGTH,
} as const;
