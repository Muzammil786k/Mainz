import { EmbedBuilder, PermissionFlagsBits, type Message, type Client } from "discord.js";
import { logCase } from "./cases";

interface Warning {
  reason: string;
  moderatorId: string;
  timestamp: number;
}

const warnings = new Map<string, Warning[]>();

function getKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export async function handleWarn(client: Client, message: Message): Promise<void> {
  if (!message.guild) return;

  const member = message.guild.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply({
      embeds: [new EmbedBuilder().setColor(0xff0000).setDescription("❌ You need the **Manage Server** permission to warn members.")],
    });
    return;
  }

  const args = message.content.trim().split(/\s+/).slice(1);
  if (args.length === 0) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("Command: !warn")
          .setDescription("**Usage:** `!warn @user [reason]`\n**Example:** `!warn @NoobLance Stop posting lewd images`"),
      ],
    });
    return;
  }

  const target = message.mentions.members?.first() ?? message.guild.members.cache.get(args[0]);
  if (!target) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setDescription("❌ Could not find that member.")] });
    return;
  }
  if (target.user.bot) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setDescription("❌ You cannot warn a bot.")] });
    return;
  }
  if (target.id === message.author.id) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setDescription("❌ You cannot warn yourself.")] });
    return;
  }

  const reason = args.slice(1).join(" ") || "No reason provided";

  const key = getKey(message.guild.id, target.id);
  if (!warnings.has(key)) warnings.set(key, []);
  warnings.get(key)!.push({ reason, moderatorId: message.author.id, timestamp: Date.now() });
  const totalWarnings = warnings.get(key)!.length;

  const c = await logCase(client, {
    type: "WARN",
    guildId: message.guild.id,
    targetId: target.id,
    targetTag: target.user.tag,
    moderatorId: message.author.id,
    reason,
  });

  await message.reply({
    embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(`✅ **${target.user.username}** has been warned. | Case **#${c.id}** | Total warnings: **${totalWarnings}**`)],
  });

  try {
    await target.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle(`⚠️ You were warned in ${message.guild.name}`)
          .addFields(
            { name: "Reason", value: reason },
            { name: "Moderator", value: `<@${message.author.id}>` },
            { name: "Total Warnings", value: `${totalWarnings}` }
          )
          .setTimestamp(),
      ],
    });
  } catch { /* DMs closed */ }
}

export async function handleWarnings(message: Message): Promise<void> {
  if (!message.guild) return;

  const member = message.guild.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setDescription("❌ You need the **Manage Server** permission to view warnings.")] });
    return;
  }

  const args = message.content.trim().split(/\s+/).slice(1);
  const target = message.mentions.members?.first() ?? (args[0] ? message.guild.members.cache.get(args[0]) : null);
  if (!target) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setDescription("❌ Please mention a member or provide their ID.\nUsage: `!warnings @user`")] });
    return;
  }

  const key = getKey(message.guild.id, target.id);
  const userWarnings = warnings.get(key) ?? [];

  if (userWarnings.length === 0) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setDescription(`✅ <@${target.id}> has no warnings.`)] });
    return;
  }

  const list = userWarnings
    .slice(-5)
    .map((w, i) => `**${i + 1}.** ${w.reason} — <@${w.moderatorId}> <t:${Math.floor(w.timestamp / 1000)}:R>`)
    .join("\n");

  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle(`⚠️ Warnings for ${target.user.username}`)
        .setDescription(list)
        .setFooter({ text: `Total warnings: ${userWarnings.length}` })
        .setTimestamp(),
    ],
  });
}

export async function handleClearWarnings(message: Message): Promise<void> {
  if (!message.guild) return;

  const member = message.guild.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setDescription("❌ You need the **Manage Server** permission to clear warnings.")] });
    return;
  }

  const args = message.content.trim().split(/\s+/).slice(1);
  const target = message.mentions.members?.first() ?? (args[0] ? message.guild.members.cache.get(args[0]) : null);
  if (!target) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setDescription("❌ Usage: `!clearwarnings @user`")] });
    return;
  }

  const key = getKey(message.guild.id, target.id);
  warnings.delete(key);

  await message.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setDescription(`✅ Cleared all warnings for <@${target.id}>.`)] });
}

export { warnings };
