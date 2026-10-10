import {
  ChannelType,
  PermissionFlagsBits,
  type Message,
} from "discord.js";
import { eq } from "drizzle-orm";
import { botExperienceSettingsTable, db } from "@workspace/db";
import { logger } from "../lib/logger";

const ECONOMY_COMMAND_PATTERN =
  /^!(?:mine|dig|fish|hunt|forage|chop|explore|work|beg|crime|flip|coinflip|cf|balance|bal|inventory|inv|sell|upgrade|craft|daily|quest|quests|leaderboard|top|pay|give|duel|shop)(?:\s|$)/i;

export async function handleEconomyChannelCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const member =
    message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need **Manage Server** permission to configure the economy channel.");
    return;
  }

  const [, action = "status"] = message.content.trim().split(/\s+/);
  const normalizedAction = action.toLowerCase();
  if (normalizedAction === "status") {
    try {
      const [settings] = await db
        .select({ channelId: botExperienceSettingsTable.economyChannelId })
        .from(botExperienceSettingsTable)
        .where(eq(botExperienceSettingsTable.guildId, guild.id));
      await message.reply(
        settings?.channelId
          ? `✅ Economy commands are restricted to <#${settings.channelId}>.`
          : "ℹ️ Economy commands are currently available in every channel.",
      );
    } catch (error) {
      logger.error({ err: error, guildId: guild.id }, "Failed to load economy channel setting");
      await message.reply("❌ Could not load the economy channel setting. Please try again.");
    }
    return;
  }

  if (normalizedAction === "remove" || normalizedAction === "reset" || normalizedAction === "disable") {
    try {
      await db
        .insert(botExperienceSettingsTable)
        .values({ guildId: guild.id, economyChannelId: null })
        .onConflictDoUpdate({
          target: botExperienceSettingsTable.guildId,
          set: { economyChannelId: null, updatedAt: new Date() },
        });
      await message.reply("✅ Economy commands are available in every channel again.");
    } catch (error) {
      logger.error({ err: error, guildId: guild.id }, "Failed to remove economy channel restriction");
      await message.reply("❌ Could not remove the economy channel restriction. Please try again.");
    }
    return;
  }

  if (normalizedAction !== "set" && normalizedAction !== "channel") {
    await message.reply("Usage: `!economy set #channel`, `!economy status`, or `!economy remove`.");
    return;
  }

  const mentionedChannel = message.mentions.channels.first();
  const channel = mentionedChannel
    ? guild.channels.cache.get(mentionedChannel.id)
    : undefined;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await message.reply("❌ Mention a server text channel. Usage: `!economy set #channel`.");
    return;
  }

  try {
    await db
      .insert(botExperienceSettingsTable)
      .values({ guildId: guild.id, economyChannelId: channel.id })
      .onConflictDoUpdate({
        target: botExperienceSettingsTable.guildId,
        set: { economyChannelId: channel.id, updatedAt: new Date() },
      });
    await message.reply(`✅ All economy commands are now restricted to ${channel}.`);
  } catch (error) {
    logger.error(
      { err: error, guildId: guild.id, channelId: channel.id },
      "Failed to set economy channel",
    );
    await message.reply("❌ Could not set the economy channel. Please try again.");
  }
}

export async function checkEconomyChannel(message: Message, content: string): Promise<boolean> {
  if (!ECONOMY_COMMAND_PATTERN.test(content)) return true;
  const guild = message.guild;
  if (!guild) return false;
  try {
    const [settings] = await db
      .select({ channelId: botExperienceSettingsTable.economyChannelId })
      .from(botExperienceSettingsTable)
      .where(eq(botExperienceSettingsTable.guildId, guild.id));
    const channelId = settings?.channelId;
    if (!channelId || channelId === message.channel.id) return true;

    await message.reply({
      content: `❌ Economy commands are only available in <#${channelId}>.`,
      allowedMentions: { parse: [] },
    });
    return false;
  } catch (error) {
    logger.error(
      { err: error, guildId: guild.id, channelId: message.channel.id },
      "Failed to check economy channel restriction",
    );
    await message.reply("❌ Could not verify the economy channel setting. Please try again.");
    return false;
  }
}
