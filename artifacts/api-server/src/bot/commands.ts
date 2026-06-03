import {
  type Message,
  type Client,
  type TextChannel,
  PermissionFlagsBits,
} from "discord.js";
import { handleAfk } from "./afk";
import { handleWarn, handleWarnings, handleClearWarnings } from "./warn";
import { handleMute, handleUnmute } from "./mute";
import { handleWordbomb, handleWordbombStop, handleWbTop } from "./wordbomb";
import { handlePurge, handlePurgeBot } from "./purge";
import { hasNoPrefix, handleNoPrefix } from "./noprefix";
import { handleHelp } from "./help";
import { startGiveaway, endGiveaway, rerollGiveaway, parseDuration } from "./giveaway";
import { handleKick, handleBan, handleUnban, handleNuke, handleSlowmode, handleLock, handleUnlock } from "./moderation";
import { handleUserInfo, handleServerInfo, handleAvatar, handleRole, handleNick, handleAnnounce } from "./utility";
import { handleSetModlog, handleCaseLookup, handleCaseList } from "./cases";

const PREFIX = "g";

export async function handleMessage(client: Client, message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild) return;

  const raw = message.content.trim();
  const noPrefix = hasNoPrefix(message);
  const content = (!raw.startsWith("!") && noPrefix) ? `!${raw}` : raw;

  await handleAfk(message, content);

  if (!content.startsWith("!") && !noPrefix) return;

  const lower = content.toLowerCase();

  // ── Giveaway ──────────────────────────────────────────────────────────────
  if (lower === `!${PREFIX}start` || lower.startsWith(`!${PREFIX}start `)) {
    await handleGstart(client, message);
  } else if (lower === `!${PREFIX}end` || lower.startsWith(`!${PREFIX}end `)) {
    await handleGend(client, message);
  } else if (lower === `!${PREFIX}reroll` || lower.startsWith(`!${PREFIX}reroll `)) {
    await handleGreroll(client, message);

  // ── Help ──────────────────────────────────────────────────────────────────
  } else if (lower === `!${PREFIX}help` || lower === "!help") {
    await handleHelp(message);

  // ── Moderation ────────────────────────────────────────────────────────────
  } else if (lower === "!warn" || lower.startsWith("!warn ")) {
    await handleWarn(client, message);
  } else if (lower === "!warnings" || lower.startsWith("!warnings ")) {
    await handleWarnings(message);
  } else if (lower === "!clearwarnings" || lower.startsWith("!clearwarnings ")) {
    await handleClearWarnings(message);
  } else if (lower === "!mute" || lower.startsWith("!mute ")) {
    await handleMute(client, message);
  } else if (lower === "!unmute" || lower.startsWith("!unmute ")) {
    await handleUnmute(client, message);
  } else if (lower === "!kick" || lower.startsWith("!kick ")) {
    await handleKick(client, message);
  } else if (lower === "!ban" || lower.startsWith("!ban ")) {
    await handleBan(client, message);
  } else if (lower === "!unban" || lower.startsWith("!unban ")) {
    await handleUnban(client, message);
  } else if (lower === "!nuke") {
    await handleNuke(message);
  } else if (lower === "!slowmode" || lower.startsWith("!slowmode ")) {
    await handleSlowmode(message);
  } else if (lower === "!lock") {
    await handleLock(message);
  } else if (lower === "!unlock") {
    await handleUnlock(message);
  } else if (lower.startsWith("!purge")) {
    await handlePurge(message);
  } else if (lower.startsWith("!pb")) {
    await handlePurgeBot(message);
  } else if (lower === "!noprefix" || lower.startsWith("!noprefix ")) {
    await handleNoPrefix(message);

  // ── Case System ───────────────────────────────────────────────────────────
  } else if (lower === "!setmodlog" || lower.startsWith("!setmodlog ")) {
    await handleSetModlog(message);
  } else if (lower === "!case" || lower.startsWith("!case ")) {
    await handleCaseLookup(message);
  } else if (lower === "!cases" || lower.startsWith("!cases ")) {
    await handleCaseList(message);

  // ── Utility ───────────────────────────────────────────────────────────────
  } else if (lower === "!userinfo" || lower.startsWith("!userinfo ")) {
    await handleUserInfo(message);
  } else if (lower === "!serverinfo") {
    await handleServerInfo(message);
  } else if (lower === "!avatar" || lower.startsWith("!avatar ")) {
    await handleAvatar(message);
  } else if (lower === "!role" || lower.startsWith("!role ")) {
    await handleRole(message);
  } else if (lower === "!nick" || lower.startsWith("!nick ")) {
    await handleNick(message);
  } else if (lower === "!announce" || lower.startsWith("!announce ")) {
    await handleAnnounce(message);

  // ── Fun / Games ───────────────────────────────────────────────────────────
  } else if (lower === "!wordbomb" || lower === "!wb") {
    await handleWordbomb(client, message);
  } else if (lower === "!wbstop" || lower === "!wordbomb stop") {
    await handleWordbombStop(message);
  } else if (lower === "!wbtop") {
    await handleWbTop(message);
  }
}

// ─── Giveaway helpers ─────────────────────────────────────────────────────────

async function handleGstart(client: Client, message: Message): Promise<void> {
  const member = message.guild!.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need the **Manage Server** permission to start giveaways.");
    return;
  }
  const args = message.content.trim().split(/\s+/).slice(1);
  if (args.length < 2) {
    await message.reply("❌ Usage: `!gstart <duration> [winners] <prize>`\nExample: `!gstart 1d 1 Nitro`\nDuration: `30s`, `5m`, `2h`, `1d`");
    return;
  }
  const duration = parseDuration(args[0]);
  if (!duration) {
    await message.reply("❌ Invalid duration. Use formats like `30s`, `5m`, `2h`, `1d`.");
    return;
  }
  let winnerCount = 1;
  let prizeStart = 1;
  if (args.length >= 3 && /^\d+$/.test(args[1])) {
    winnerCount = Math.max(1, Math.min(20, parseInt(args[1])));
    prizeStart = 2;
  }
  const prize = args.slice(prizeStart).join(" ");
  if (!prize) {
    await message.reply("❌ Please provide a prize name.");
    return;
  }
  const channel = message.channel as TextChannel;
  const result = await startGiveaway(client, channel, message.author.id, message.guild!.id, duration, prize, winnerCount);
  if (result.success) {
    await message.delete().catch(() => {});
  } else {
    await message.reply(`❌ ${result.message}`);
  }
}

async function handleGend(client: Client, message: Message): Promise<void> {
  const member = message.guild!.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need the **Manage Server** permission to end giveaways.");
    return;
  }
  const args = message.content.trim().split(/\s+/).slice(1);
  if (!args[0]) {
    await message.reply("❌ Usage: `!gend <message_id>`");
    return;
  }
  const result = await endGiveaway(client, args[0]);
  if (!result.success) await message.reply(`❌ ${result.message}`);
}

async function handleGreroll(client: Client, message: Message): Promise<void> {
  const member = message.guild!.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need the **Manage Server** permission to reroll giveaways.");
    return;
  }
  const args = message.content.trim().split(/\s+/).slice(1);
  if (!args[0]) {
    await message.reply("❌ Usage: `!greroll <message_id> [amount]`");
    return;
  }
  let winnerOverride: number | undefined;
  if (args[1]) {
    const n = parseInt(args[1]);
    if (isNaN(n) || n < 1 || n > 20) {
      await message.reply("❌ Amount must be a number between 1 and 20.");
      return;
    }
    winnerOverride = n;
  }
  const result = await rerollGiveaway(client, args[0], winnerOverride);
  if (!result.success) await message.reply(`❌ ${result.message}`);
}
