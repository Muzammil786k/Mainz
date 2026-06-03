import {
  EmbedBuilder,
  PermissionFlagsBits,
  type Message,
  type Client,
  type TextChannel,
} from "discord.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const C = 0xff0000;
const DATA_DIR = join(process.cwd(), "data");
const CASES_FILE = join(DATA_DIR, "cases.json");
const MODLOG_FILE = join(DATA_DIR, "modlog.json");

// ─── Types ────────────────────────────────────────────────────────────────────

export type CaseType = "WARN" | "MUTE" | "UNMUTE" | "KICK" | "BAN" | "UNBAN";

export interface ModerationCase {
  id: number;
  type: CaseType;
  guildId: string;
  targetId: string;
  targetTag: string;
  moderatorId: string;
  reason: string;
  timestamp: number;
}

type CaseStore = Record<string, ModerationCase[]>;
type ModlogStore = Record<string, string>;

// ─── File I/O ─────────────────────────────────────────────────────────────────

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadCases(): CaseStore {
  try {
    if (!existsSync(CASES_FILE)) return {};
    return JSON.parse(readFileSync(CASES_FILE, "utf-8")) as CaseStore;
  } catch {
    return {};
  }
}

function saveCases(data: CaseStore): void {
  ensureDataDir();
  writeFileSync(CASES_FILE, JSON.stringify(data, null, 2));
}

function loadModlog(): ModlogStore {
  try {
    if (!existsSync(MODLOG_FILE)) return {};
    return JSON.parse(readFileSync(MODLOG_FILE, "utf-8")) as ModlogStore;
  } catch {
    return {};
  }
}

function saveModlog(data: ModlogStore): void {
  ensureDataDir();
  writeFileSync(MODLOG_FILE, JSON.stringify(data, null, 2));
}

// ─── Core API ─────────────────────────────────────────────────────────────────

export function setModlogChannel(guildId: string, channelId: string): void {
  const store = loadModlog();
  store[guildId] = channelId;
  saveModlog(store);
}

export function getModlogChannel(guildId: string): string | null {
  return loadModlog()[guildId] ?? null;
}

export function getNextCaseId(guildId: string): number {
  const store = loadCases();
  const cases = store[guildId] ?? [];
  return cases.length > 0 ? cases[cases.length - 1].id + 1 : 1;
}

export function saveCase(c: ModerationCase): void {
  const store = loadCases();
  if (!store[c.guildId]) store[c.guildId] = [];
  store[c.guildId].push(c);
  saveCases(store);
}

export function getCase(guildId: string, caseId: number): ModerationCase | null {
  const store = loadCases();
  return (store[guildId] ?? []).find((c) => c.id === caseId) ?? null;
}

export function getRecentCases(
  guildId: string,
  targetId: string | null,
  limit = 10
): ModerationCase[] {
  const store = loadCases();
  const all = (store[guildId] ?? []).slice().reverse();
  const filtered = targetId ? all.filter((c) => c.targetId === targetId) : all;
  return filtered.slice(0, limit);
}

// ─── Log Case to Modlog Channel ───────────────────────────────────────────────

const CASE_COLORS: Record<CaseType, number> = {
  WARN:   0xffa500,
  MUTE:   0xff6600,
  UNMUTE: 0x57f287,
  KICK:   0xff4444,
  BAN:    0xff0000,
  UNBAN:  0x57f287,
};

const CASE_EMOJIS: Record<CaseType, string> = {
  WARN:   "⚠️",
  MUTE:   "🔇",
  UNMUTE: "🔊",
  KICK:   "🥾",
  BAN:    "🔨",
  UNBAN:  "🔓",
};

export async function logCase(
  client: Client,
  data: Omit<ModerationCase, "id" | "timestamp">
): Promise<ModerationCase> {
  const id = getNextCaseId(data.guildId);
  const c: ModerationCase = { ...data, id, timestamp: Date.now() };
  saveCase(c);

  const channelId = getModlogChannel(data.guildId);
  if (channelId) {
    try {
      const channel = await client.channels.fetch(channelId) as TextChannel | null;
      if (channel?.isTextBased()) {
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(CASE_COLORS[c.type])
              .setTitle(`${CASE_EMOJIS[c.type]} Case #${c.id} — ${c.type}`)
              .addFields(
                { name: "Member", value: `<@${c.targetId}> \`${c.targetTag}\``, inline: true },
                { name: "Moderator", value: `<@${c.moderatorId}>`, inline: true },
                { name: "Reason", value: c.reason, inline: false },
              )
              .setFooter({ text: `Case ID: ${c.id}` })
              .setTimestamp(c.timestamp),
          ],
        });
      }
    } catch {
      // Modlog channel unavailable
    }
  }

  return c;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export async function handleSetModlog(message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Manage Server** permission.")] });
    return;
  }
  const channel = message.mentions.channels.first() as TextChannel | undefined;
  if (!channel) {
    const cur = getModlogChannel(message.guild.id);
    if (cur) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription(`📋 Current mod-log channel: <#${cur}>\nUse \`!setmodlog #channel\` to change it.`)] });
    } else {
      await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Usage: `!setmodlog #channel`")] });
    }
    return;
  }
  setModlogChannel(message.guild.id, channel.id);
  await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription(`✅ Mod-log channel set to ${channel}.\nAll moderation actions will be logged there.`)] });
}

export async function handleCaseLookup(message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Manage Server** permission.")] });
    return;
  }
  const args = message.content.trim().split(/\s+/).slice(1);
  const id = parseInt(args[0]);
  if (isNaN(id)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Usage: `!case <id>`")] });
    return;
  }
  const c = getCase(message.guild.id, id);
  if (!c) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription(`❌ Case **#${id}** not found.`)] });
    return;
  }
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(CASE_COLORS[c.type])
        .setTitle(`${CASE_EMOJIS[c.type]} Case #${c.id} — ${c.type}`)
        .addFields(
          { name: "Member", value: `<@${c.targetId}> \`${c.targetTag}\``, inline: true },
          { name: "Moderator", value: `<@${c.moderatorId}>`, inline: true },
          { name: "Reason", value: c.reason, inline: false },
          { name: "Date", value: `<t:${Math.floor(c.timestamp / 1000)}:F>`, inline: false },
        )
        .setFooter({ text: `Case #${c.id}` })
        .setTimestamp(c.timestamp),
    ],
  });
}

export async function handleCaseList(message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Manage Server** permission.")] });
    return;
  }

  const target = message.mentions.members?.first() ??
    (message.content.trim().split(/\s+/)[1] ? message.guild.members.cache.get(message.content.trim().split(/\s+/)[1]) : null);

  const cases = getRecentCases(message.guild.id, target?.id ?? null, 10);

  if (cases.length === 0) {
    await message.reply({
      embeds: [new EmbedBuilder().setColor(C).setDescription(target ? `✅ No cases found for **${target.user.username}**.` : "✅ No cases found in this server.")],
    });
    return;
  }

  const list = cases
    .map((c) => `\`#${c.id}\` ${CASE_EMOJIS[c.type]} **${c.type}** — <@${c.targetId}> by <@${c.moderatorId}> — ${c.reason.slice(0, 40)}${c.reason.length > 40 ? "…" : ""} <t:${Math.floor(c.timestamp / 1000)}:R>`)
    .join("\n");

  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(C)
        .setTitle(target ? `📋 Cases for ${target.user.username}` : "📋 Recent Cases")
        .setDescription(list)
        .setFooter({ text: `Showing ${cases.length} most recent cases` })
        .setTimestamp(),
    ],
  });
}
