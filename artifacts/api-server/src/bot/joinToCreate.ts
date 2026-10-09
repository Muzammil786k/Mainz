import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type VoiceState,
} from "discord.js";
import { logger } from "../lib/logger";

// Temporary channel IDs created by the bot. State is in-memory only.
const tempChannels = new Set<string>();

// Members currently having a channel created for them, to avoid duplicates on rapid rejoins.
const pendingMembers = new Set<string>();

async function createTempChannel(client: Client, newState: VoiceState): Promise<void> {
  const member = newState.member;
  const lobby = newState.channel;
  if (!member || !lobby) return;

  const pendingKey = `${newState.guild.id}:${member.id}`;
  if (pendingMembers.has(pendingKey)) return;
  pendingMembers.add(pendingKey);

  let created: Awaited<ReturnType<typeof newState.guild.channels.create>> | null = null;
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
    tempChannels.add(created.id);

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
  if (channel.members.size !== 0) return;

  tempChannels.delete(channel.id);
  try {
    await channel.delete("Join to Create: channel is empty");
    logger.info({ guildId: oldState.guild.id, channelId: channel.id }, "Deleted empty join-to-create channel");
  } catch (err) {
    logger.error({ err, guildId: oldState.guild.id, channelId: channel.id }, "Failed to delete join-to-create channel");
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
