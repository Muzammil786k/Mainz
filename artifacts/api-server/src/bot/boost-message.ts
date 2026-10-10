import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type GuildMember,
  type Message,
  type PartialGuildMember,
} from "discord.js";
import { eq } from "drizzle-orm";
import { botGuildMessagesTable, db } from "@workspace/db";
import { logger } from "../lib/logger";
import { premiumColors } from "./presentation";

const DEFAULT_BOOST_TITLE = "Just boosted!";
const DEFAULT_BOOST_TEMPLATE =
  "<:unlocked:1537457404503924796> **__Perks Unlocked__**\n" +
  "<:1_:1348245004149325906> <:smile:1347194662762450966> **Custom** role with unique appearance\n" +
  "<:2_:1348245063666237480> <:booster:1348245070406619136> **20%** XP Gain\n" +
  "<:3_:1348245110143451179> <:picture:1468998839854960791> **Send** external stickers\n" +
  "<:icons_4:1348245158118035529> <:voice:1538255380147085342> **Send** voice notes in lounges\n" +
  "<:icons_5:1348245235037376563> <a:sound:1224518002725359647> **Access** to soundboard\n" +
  "<:no_6:1370834866010325173> <:streamer:1544684984722260018> **Access** to stream in VC\n" +
  "<:icons_7:1492991320547922071> <:Camera:1544684823539351562> **Access** to turn on camera in VC\n" +
  "<:icons_8:1520271536068497498> <:win:1347194587071905854> **Access** to Socialize Fun social commands\n" +
  "<:icons_9:1520271553860866118> <:achievement:1537875562616459305> **Recognition** on the server leaderboard";

export async function handleBoostMessageCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const member =
    message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need **Manage Server** permission to configure boost messages.");
    return;
  }

  const [, action = "status"] = message.content.trim().split(/\s+/);
  const normalizedAction = action.toLowerCase();
  try {
    if (normalizedAction === "status") {
      const [settings] = await db
        .select({
          channelId: botGuildMessagesTable.boostChannelId,
          title: botGuildMessagesTable.boostTitle,
          template: botGuildMessagesTable.boostTemplate,
        })
        .from(botGuildMessagesTable)
        .where(eq(botGuildMessagesTable.guildId, guild.id));
      await message.reply(
        settings?.channelId
          ? `✅ Server boost announcements are enabled in <#${settings.channelId}>.\nTitle: ${settings.title ?? "default"}\nDescription: ${settings.template ? "custom" : "default"}`
          : "ℹ️ Server boost announcements are not configured. Use `!boostmessage set #channel`.",
      );
      return;
    }

    if (
      normalizedAction === "remove" ||
      normalizedAction === "disable" ||
      normalizedAction === "off"
    ) {
      await db
        .insert(botGuildMessagesTable)
        .values({ guildId: guild.id, boostChannelId: null })
        .onConflictDoUpdate({
          target: botGuildMessagesTable.guildId,
          set: { boostChannelId: null, updatedAt: new Date() },
        });
      await message.reply("✅ Server boost announcements are disabled.");
      return;
    }

    if (normalizedAction === "reset") {
      await db
        .insert(botGuildMessagesTable)
        .values({ guildId: guild.id, boostTitle: null, boostTemplate: null })
        .onConflictDoUpdate({
          target: botGuildMessagesTable.guildId,
          set: {
            boostTitle: null,
            boostTemplate: null,
            updatedAt: new Date(),
          },
        });
      await message.reply("✅ Boost embed title and description have been reset to the default.");
      return;
    }

    if (normalizedAction === "title" || normalizedAction === "edit") {
      const commandMatch = /^!boostmessage\s+(?:title|edit)\s+/i.exec(message.content.trim());
      const value = commandMatch
        ? message.content.trim().slice(commandMatch[0].length).trim()
        : "";
      if (!value) {
        await message.reply(
          `❌ Add the text to set. Usage: \`!boostmessage ${normalizedAction} <text>\`. Use \`!boostmessage reset\` to restore the defaults.`,
        );
        return;
      }
      const field = normalizedAction === "title" ? "boostTitle" : "boostTemplate";
      const maxLength = normalizedAction === "title" ? 256 : 4096;
      if (value.length > maxLength) {
        await message.reply(`❌ Boost embed ${normalizedAction} must be ${maxLength} characters or fewer.`);
        return;
      }
      await db
        .insert(botGuildMessagesTable)
        .values({ guildId: guild.id, [field]: value })
        .onConflictDoUpdate({
          target: botGuildMessagesTable.guildId,
          set: { [field]: value, updatedAt: new Date() },
        });
      await message.reply(
        `✅ Boost embed ${normalizedAction === "title" ? "title" : "description"} updated. Use \`{user}\`, \`{username}\`, and \`{server}\` as placeholders.`,
      );
      return;
    }

    if (normalizedAction !== "set") {
      await message.reply("Usage: `!boostmessage set #channel`, `!boostmessage title <text>`, `!boostmessage edit <description>`, `!boostmessage reset`, `!boostmessage status`, or `!boostmessage remove`.");
      return;
    }
    const mentionedChannel = message.mentions.channels.first();
    const channel = mentionedChannel
      ? guild.channels.cache.get(mentionedChannel.id)
      : undefined;
    if (!channel || channel.type !== ChannelType.GuildText) {
      await message.reply("❌ Mention a server text channel. Usage: `!boostmessage set #channel`.");
      return;
    }
    await db
      .insert(botGuildMessagesTable)
      .values({ guildId: guild.id, boostChannelId: channel.id })
      .onConflictDoUpdate({
        target: botGuildMessagesTable.guildId,
        set: { boostChannelId: channel.id, updatedAt: new Date() },
      });
    await message.reply(`✅ Server boost announcements will be sent to ${channel}.`);
  } catch (error) {
    logger.error({ err: error, guildId: guild.id, action: normalizedAction }, "Boost message configuration failed");
    await message.reply("❌ Could not update boost message settings. Please try again.");
  }
}

export async function sendBoostMessage(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  const [settings] = await db
    .select({
      channelId: botGuildMessagesTable.boostChannelId,
      title: botGuildMessagesTable.boostTitle,
      template: botGuildMessagesTable.boostTemplate,
    })
    .from(botGuildMessagesTable)
    .where(eq(botGuildMessagesTable.guildId, member.guild.id));
  const channelId = settings?.channelId;
  if (!channelId) return;

  const channel = await member.guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText || !channel.isSendable()) {
    logger.warn(
      { guildId: member.guild.id, channelId, userId: member.id },
      "Configured boost announcement channel is unavailable",
    );
    return;
  }

  const template = settings.template ?? DEFAULT_BOOST_TEMPLATE;
  const description = template
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{username}", member.displayName)
    .replaceAll("{server}", member.guild.name);
  const embed = new EmbedBuilder()
    .setColor(premiumColors.brand)
    .setTitle(settings.title ?? DEFAULT_BOOST_TITLE)
    .setDescription(description)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `${member.displayName} boosted ${member.guild.name}` })
    .setTimestamp();

  await channel.send({
    content: `<@${member.id}>`,
    embeds: [embed],
    allowedMentions: { users: [member.id] },
  });
}
