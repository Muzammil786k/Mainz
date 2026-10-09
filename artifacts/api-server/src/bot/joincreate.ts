import {
  ChannelType,
  PermissionFlagsBits,
  type Message,
  type VoiceState,
} from "discord.js";
import { logger } from "../lib/logger";

// guildId -> hub voice channelId
const hubs = new Map<string, string>();
// temp channelId -> ownerId
const tempChannels = new Map<string, string>();

export async function handleJoinCreateCommand(message: Message): Promise<void> {
  try {
    const guild = message.guild;
    const member = message.member;
    if (!guild || !member) return;

    const args = message.content.trim().split(/\s+/).slice(1);
    const sub = args[0]?.toLowerCase();

    if (sub !== "setup" && sub !== "disable") {
      await message.reply("Usage: `!jtc setup` (while in a voice channel) or `!jtc disable`");
      return;
    }

    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await message.reply("❌ You need the **Manage Channels** permission to use this.");
      return;
    }

    if (sub === "setup") {
      const voiceChannel = member.voice.channel;
      if (!voiceChannel) {
        await message.reply("❌ Join the voice channel you want to use as the hub, then run `!jtc setup`.");
        return;
      }
      hubs.set(guild.id, voiceChannel.id);
      await message.reply(`✅ Join-to-create hub set to **${voiceChannel.name}**.`);
      return;
    }

    hubs.delete(guild.id);
    await message.reply("✅ Join-to-create has been disabled.");
  } catch (err) {
    logger.warn({ err }, "Join-to-create command failed");
  }
}

export async function handleJoinCreateVoiceState(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  try {
    const member = newState.member ?? oldState.member;

    if (newState.channelId && member && newState.channelId === hubs.get(newState.guild.id)) {
      try {
        const hub = newState.channel;
        const temp = await newState.guild.channels.create({
          name: `${member.displayName}'s channel`.slice(0, 100),
          type: ChannelType.GuildVoice,
          parent: hub?.parentId ?? null,
          permissionOverwrites: [
            {
              id: member.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.MoveMembers,
              ],
            },
          ],
        });
        tempChannels.set(temp.id, member.id);
        try {
          await member.voice.setChannel(temp);
        } catch (err) {
          logger.warn({ err, guildId: newState.guild.id }, "Join-to-create: failed to move member");
        }
      } catch (err) {
        logger.warn({ err, guildId: newState.guild.id }, "Join-to-create: failed to create channel");
      }
    }

    if (
      oldState.channelId &&
      tempChannels.has(oldState.channelId) &&
      oldState.channel?.members.size === 0
    ) {
      const channelId = oldState.channelId;
      try {
        await oldState.channel.delete();
        tempChannels.delete(channelId);
      } catch (err) {
        logger.warn({ err, channelId }, "Join-to-create: failed to delete channel");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Join-to-create voice state handling failed");
  }
}
