import {
  PermissionFlagsBits,
  type Client,
  type GuildBasedChannel,
  type Message,
} from "discord.js";
import { logger } from "../lib/logger";
import {
  automationLimits,
  bumpStickyForChannel,
  getChannelAutomationSettings,
  removeChannelAutoReact,
  removeChannelSticky,
  removeGuildMessage,
  setChannelAutoReact,
  setChannelSticky,
  setGuildMessage,
} from "./automation";

async function requireManageServer(message: Message): Promise<boolean> {
  const guild = message.guild;
  if (!guild) return false;
  const member =
    message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
  if (member?.permissions.has(PermissionFlagsBits.ManageGuild)) return true;

  await message.reply({
    content: "❌ You need **Manage Server** permission to change automation settings.",
    allowedMentions: { parse: [], repliedUser: false },
  });
  return false;
}

function mentionedTextChannel(message: Message): GuildBasedChannel | null {
  const guild = message.guild;
  const mentionedChannel = message.mentions.channels.first();
  if (!guild || !mentionedChannel) return null;
  const channel = guild.channels.cache.get(mentionedChannel.id);
  if (!channel || !channel.isTextBased()) return null;
  return channel;
}

function textAfterChannelMention(message: Message, channel: GuildBasedChannel): string {
  const mention = `<#${channel.id}>`;
  const mentionIndex = message.content.indexOf(mention);
  return mentionIndex < 0
    ? ""
    : message.content.slice(mentionIndex + mention.length).trim();
}

async function saveFailure(message: Message, feature: string, error: unknown): Promise<void> {
  logger.error(
    { err: error, guildId: message.guild?.id, feature },
    "Could not save bot automation settings",
  );
  await message
    .reply({
      content: `❌ I couldn't save the ${feature} settings. Please try again.`,
      allowedMentions: { parse: [], repliedUser: false },
    })
    .catch(() => {});
}

export async function handleAutoReactCommand(message: Message): Promise<void> {
  if (!message.guild || !(await requireManageServer(message))) return;

  const args = message.content.trim().split(/\s+/);
  const action = args[1]?.toLowerCase();
  const channel = mentionedTextChannel(message);
  if (!channel) {
    await message.reply({
      content:
        "❌ Mention a text channel. Usage: `!autoreact set #channel <:emoji:id>`, `!autoreact remove #channel`, or `!autoreact status #channel`.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (action === "set") {
    const emojiText = textAfterChannelMention(message, channel);
    const match = /^<a?:[A-Za-z0-9_]{2,32}:(\d{17,20})>$/.exec(emojiText);
    const emoji = match ? message.guild.emojis.cache.get(match[1]!) : undefined;
    if (!emoji) {
      await message.reply({
        content:
          "❌ Use one custom emoji from this server, for example `!autoreact set #chat <:sparkle:123456789012345678>`.",
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    try {
      await setChannelAutoReact(message.guild.id, channel.id, emoji.toString());
      await message.reply({
        content: `✅ Auto-react is on in ${channel}. I’ll react to every new message with ${emoji}.`,
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (error) {
      await saveFailure(message, "auto-react", error);
    }
    return;
  }

  if (action === "remove" || action === "disable") {
    try {
      const removed = await removeChannelAutoReact(message.guild.id, channel.id);
      await message.reply({
        content: removed
          ? `✅ Auto-react is off in ${channel}.`
          : `ℹ️ Auto-react was not configured in ${channel}.`,
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (error) {
      await saveFailure(message, "auto-react", error);
    }
    return;
  }

  if (action === "status") {
    try {
      const settings = await getChannelAutomationSettings(message.guild.id, channel.id);
      await message.reply({
        content: settings?.autoReactEmoji
          ? `✨ Auto-react is on in ${channel} with ${settings.autoReactEmoji}.`
          : `ℹ️ Auto-react is off in ${channel}.`,
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (error) {
      await saveFailure(message, "auto-react", error);
    }
    return;
  }

  await message.reply({
    content:
      "ℹ️ Usage: `!autoreact set #channel <:emoji:id>`, `!autoreact remove #channel`, or `!autoreact status #channel`.",
    allowedMentions: { parse: [], repliedUser: false },
  });
}

export async function handleStickyCommand(
  client: Client,
  message: Message,
): Promise<void> {
  if (!message.guild || !(await requireManageServer(message))) return;

  const args = message.content.trim().split(/\s+/);
  const action = args[1]?.toLowerCase();
  const channel = mentionedTextChannel(message);
  if (!channel) {
    await message.reply({
      content:
        "❌ Mention a text channel. Usage: `!sticky set #channel <message>` or `!sticky remove #channel`.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (action === "set") {
    const content = textAfterChannelMention(message, channel);
    if (!content || content.length > automationLimits.maxStickyContentLength) {
      await message.reply({
        content: `❌ Sticky text must be between 1 and ${automationLimits.maxStickyContentLength} characters.`,
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    try {
      await setChannelSticky(message.guild.id, channel.id, content);
      await bumpStickyForChannel(client, message.guild.id, channel.id);
      await message.reply({
        content: `✅ Sticky message set for ${channel}. It will be moved to the bottom after each new message.`,
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (error) {
      await saveFailure(message, "sticky message", error);
    }
    return;
  }

  if (action === "remove" || action === "disable") {
    try {
      const result = await removeChannelSticky(message.guild.id, channel.id);
      if (result.messageId) {
        const stickyChannel = await client.channels.fetch(channel.id).catch(() => null);
        if (stickyChannel?.isTextBased() && "guildId" in stickyChannel) {
          const sticky = await stickyChannel.messages.fetch(result.messageId).catch(() => null);
          if (sticky && sticky.author.id === client.user?.id) {
            await sticky.delete().catch((error: unknown) => {
              logger.warn(
                { err: error, guildId: message.guild?.id, channelId: channel.id },
                "Could not delete the old sticky message",
              );
            });
          }
        }
      }
      await message.reply({
        content: result.removed
          ? `✅ Sticky message removed from ${channel}.`
          : `ℹ️ No sticky message was configured in ${channel}.`,
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (error) {
      await saveFailure(message, "sticky message", error);
    }
    return;
  }

  await message.reply({
    content: "ℹ️ Usage: `!sticky set #channel <message>` or `!sticky remove #channel`.",
    allowedMentions: { parse: [], repliedUser: false },
  });
}

async function handleMemberMessageCommand(
  message: Message,
  kind: "welcome" | "goodbye",
): Promise<void> {
  if (!message.guild || !(await requireManageServer(message))) return;

  const args = message.content.trim().split(/\s+/);
  const action = args[1]?.toLowerCase();
  if (action === "remove" || action === "disable" || action === "off") {
    try {
      const removed = await removeGuildMessage(message.guild.id, kind);
      await message.reply({
        content: removed
          ? `✅ ${kind === "welcome" ? "Welcome" : "Goodbye"} messages are off.`
          : `ℹ️ No ${kind} message was configured.`,
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (error) {
      await saveFailure(message, `${kind} message`, error);
    }
    return;
  }

  const channel = mentionedTextChannel(message);
  const template = channel ? textAfterChannelMention(message, channel) : "";
  if (action !== "set" || !channel || !template || template.length > 1_800) {
    await message.reply({
      content:
        `ℹ️ Usage: \`!${kind} set #channel <message>\` or \`!${kind} remove\`.\n` +
        "Placeholders: `{user}`, `{server}`, and `{memberCount}`.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  try {
    await setGuildMessage(message.guild.id, kind, channel.id, template);
    await message.reply({
      content:
        `✅ ${kind === "welcome" ? "Welcome" : "Goodbye"} message set in ${channel}.\n` +
        "Placeholders `{user}`, `{server}`, and `{memberCount}` will be filled in automatically.",
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (error) {
    await saveFailure(message, `${kind} message`, error);
  }
}

export function handleWelcomeCommand(message: Message): Promise<void> {
  return handleMemberMessageCommand(message, "welcome");
}

export function handleGoodbyeCommand(message: Message): Promise<void> {
  return handleMemberMessageCommand(message, "goodbye");
}
