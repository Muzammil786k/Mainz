import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Message,
  type VoiceState,
} from "discord.js";
import { logger } from "../lib/logger";

export interface JtcConfig {
  lobbyChannelId: string;
  categoryId: string | null;
}

/** guildId -> lobby configuration (in-memory, resets on restart). */
export const jtcConfigs = new Map<string, JtcConfig>();

/** channelId -> ownerId for temporary channels created by this feature. */
export const jtcTempChannels = new Map<string, string>();

const LOBBY_NAME = "➕ Join to Create";

const USAGE = [
  "**Join to Create**",
  "`!jtc setup` — Create a lobby voice channel. Members who join it get their own temporary voice channel.",
  "`!jtc disable` — Stop using the current lobby (the channel itself is not deleted).",
].join("\n");

export async function handleJtc(message: Message): Promise<void> {
  const args = message.content.trim().split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (sub === "setup") {
    await handleJtcSetup(message);
  } else if (sub === "disable") {
    await handleJtcDisable(message);
  } else {
    await message.reply(USAGE);
  }
}

function canManage(message: Message): boolean {
  const perms = message.member?.permissions;
  return !!perms && (perms.has(PermissionFlagsBits.ManageGuild) || perms.has(PermissionFlagsBits.ManageChannels));
}

export async function handleJtcSetup(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  if (!canManage(message)) {
    await message.reply("❌ You need the **Manage Server** or **Manage Channels** permission to use this command.");
    return;
  }

  const channel = message.channel;
  const categoryId = !channel.isThread() && "parentId" in channel ? channel.parentId : null;

  try {
    const lobby = await guild.channels.create({
      name: LOBBY_NAME,
      type: ChannelType.GuildVoice,
      parent: categoryId,
      reason: `Join to Create setup by ${message.author.tag}`,
    });
    jtcConfigs.set(guild.id, { lobbyChannelId: lobby.id, categoryId });
    await message.reply(`✅ Join to Create is ready. Members who join <#${lobby.id}> will get their own voice channel.`);
  } catch (err) {
    logger.error({ err, guildId: guild.id }, "JTC setup failed");
    await message.reply("❌ I couldn't create the lobby channel. Make sure I have the **Manage Channels** permission.");
  }
}

export async function handleJtcDisable(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  if (!canManage(message)) {
    await message.reply("❌ You need the **Manage Server** or **Manage Channels** permission to use this command.");
    return;
  }

  if (!jtcConfigs.delete(guild.id)) {
    await message.reply("❌ Join to Create is not set up in this server.");
    return;
  }
  await message.reply("✅ Join to Create has been disabled. The lobby channel was not deleted.");
}

export async function handleVoiceStateUpdate(
  _client: Client,
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const guild = newState.guild;
  const config = jtcConfigs.get(guild.id);

  // Clear config if the lobby channel was deleted.
  if (config && !guild.channels.cache.has(config.lobbyChannelId)) {
    jtcConfigs.delete(guild.id);
  }

  // Cleanup: delete empty temporary channels.
  const oldChannelId = oldState.channelId;
  if (oldChannelId && oldChannelId !== newState.channelId && jtcTempChannels.has(oldChannelId)) {
    if (oldState.channel?.members.size === 0) {
      jtcTempChannels.delete(oldChannelId);
      try {
        await oldState.channel.delete("Join to Create channel is empty");
      } catch (err) {
        logger.error({ err, channelId: oldChannelId }, "JTC failed to delete empty channel");
      }
    }
  }

  // Creation: member joined the lobby.
  const lobby = jtcConfigs.get(guild.id);
  const member = newState.member;
  if (!lobby || !member || member.user.bot) return;
  if (newState.channelId !== lobby.lobbyChannelId) return;

  try {
    const newChannel = await guild.channels.create({
      name: `${member.displayName}'s channel`,
      type: ChannelType.GuildVoice,
      parent: newState.channel?.parentId ?? null,
      permissionOverwrites: [
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.ViewChannel,
          ],
        },
      ],
      reason: `Join to Create channel for ${member.user.tag}`,
    });
    jtcTempChannels.set(newChannel.id, member.id);

    try {
      await member.voice.setChannel(newChannel);
    } catch (err) {
      // Member left or can't be moved; don't leave an orphaned channel behind.
      jtcTempChannels.delete(newChannel.id);
      await newChannel.delete("Join to Create: could not move member").catch(() => {});
      throw err;
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id, userId: member.id }, "JTC failed to create channel");
  }
}
