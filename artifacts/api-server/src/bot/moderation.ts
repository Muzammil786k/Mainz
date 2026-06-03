import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits,
  type Message,
  type TextChannel,
  type Client,
} from "discord.js";
import { logCase } from "./cases";

const C = 0xff0000;

// ─── Kick ──────────────────────────────────────────────────────────────────────

export async function handleKick(client: Client, message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.KickMembers)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Kick Members** permission.")] });
    return;
  }
  const args = message.content.trim().split(/\s+/).slice(1);
  const target = message.mentions.members?.first() ?? (args[0] ? message.guild.members.cache.get(args[0]) : null);
  if (!target) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Usage: `!kick @user [reason]`")] });
    return;
  }
  if (!target.kickable) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ I cannot kick that member. Make sure my role is above theirs.")] });
    return;
  }
  if (target.id === message.author.id) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You cannot kick yourself.")] });
    return;
  }
  const reason = args.slice(1).join(" ") || "No reason provided";
  try {
    await target.send({ embeds: [new EmbedBuilder().setColor(C).setTitle(`🥾 You were kicked from ${message.guild.name}`).addFields({ name: "Reason", value: reason })] }).catch(() => {});
    await target.kick(reason);
    const c = await logCase(client, { type: "KICK", guildId: message.guild.id, targetId: target.id, targetTag: target.user.tag, moderatorId: message.author.id, reason });
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription(`✅ **${target.user.username}** has been kicked. | Case **#${c.id}**\n**Reason:** ${reason}`)] });
  } catch {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Failed to kick that member.")] });
  }
}

// ─── Ban ───────────────────────────────────────────────────────────────────────

export async function handleBan(client: Client, message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.BanMembers)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Ban Members** permission.")] });
    return;
  }
  const args = message.content.trim().split(/\s+/).slice(1);
  const target = message.mentions.members?.first() ?? (args[0] ? message.guild.members.cache.get(args[0]) : null);
  if (!target) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Usage: `!ban @user [reason]`")] });
    return;
  }
  if (!target.bannable) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ I cannot ban that member.")] });
    return;
  }
  if (target.id === message.author.id) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You cannot ban yourself.")] });
    return;
  }
  const reason = args.slice(1).join(" ") || "No reason provided";
  try {
    await target.send({ embeds: [new EmbedBuilder().setColor(C).setTitle(`🔨 You were banned from ${message.guild.name}`).addFields({ name: "Reason", value: reason })] }).catch(() => {});
    await target.ban({ reason });
    const c = await logCase(client, { type: "BAN", guildId: message.guild.id, targetId: target.id, targetTag: target.user.tag, moderatorId: message.author.id, reason });
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription(`✅ **${target.user.username}** has been banned. | Case **#${c.id}**\n**Reason:** ${reason}`)] });
  } catch {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Failed to ban that member.")] });
  }
}

// ─── Unban ─────────────────────────────────────────────────────────────────────

export async function handleUnban(client: Client, message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.BanMembers)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Ban Members** permission.")] });
    return;
  }
  const args = message.content.trim().split(/\s+/).slice(1);
  const userId = args[0];
  if (!userId) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Usage: `!unban <user_id>`")] });
    return;
  }
  try {
    const ban = await message.guild.bans.fetch(userId).catch(() => null);
    const targetTag = ban?.user.tag ?? userId;
    await message.guild.bans.remove(userId);
    const c = await logCase(client, { type: "UNBAN", guildId: message.guild.id, targetId: userId, targetTag, moderatorId: message.author.id, reason: "Manual unban" });
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription(`✅ User \`${targetTag}\` has been unbanned. | Case **#${c.id}**`)] });
  } catch {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Could not unban that user. Make sure the ID is correct.")] });
  }
}

// ─── Nuke ─────────────────────────────────────────────────────────────────────

export async function handleNuke(message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Manage Channels** permission.")] });
    return;
  }

  const channel = message.channel as TextChannel;

  const confirmMsg = await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(C)
        .setTitle("⚠️ Confirm Nuke")
        .setDescription("This will **delete all messages** in this channel by cloning it.\nClick **Confirm** to proceed or **Cancel** to abort."),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("nuke_confirm").setLabel("Confirm").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("nuke_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });

  const collector = confirmMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 15_000,
    filter: (i) => i.user.id === message.author.id,
    max: 1,
  });

  collector.on("collect", async (interaction) => {
    if (interaction.customId === "nuke_cancel") {
      await interaction.update({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Nuke cancelled.")], components: [] });
      return;
    }
    await interaction.deferUpdate();
    try {
      const position = channel.position;
      const newChannel = await channel.clone({ reason: `Nuke by ${message.author.tag}` });
      await newChannel.setPosition(position);
      await channel.delete();
      await newChannel.send({ embeds: [new EmbedBuilder().setColor(C).setDescription("💥 Channel has been nuked.")] });
    } catch {
      await (message.channel as TextChannel).send({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Failed to nuke channel.")] }).catch(() => {});
    }
  });

  collector.on("end", async (_c, reason) => {
    if (reason === "time") {
      await confirmMsg.edit({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Nuke timed out.")], components: [] }).catch(() => {});
    }
  });
}

// ─── Slowmode ─────────────────────────────────────────────────────────────────

export async function handleSlowmode(message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Manage Channels** permission.")] });
    return;
  }
  const args = message.content.trim().split(/\s+/).slice(1);
  const seconds = parseInt(args[0]);
  if (isNaN(seconds) || seconds < 0 || seconds > 21600) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Usage: `!slowmode <seconds>` (0–21600)")] });
    return;
  }
  try {
    await (message.channel as TextChannel).setRateLimitPerUser(seconds);
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription(seconds === 0 ? "✅ Slowmode disabled." : `✅ Slowmode set to **${seconds}s**.`)] });
  } catch {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Failed to set slowmode.")] });
  }
}

// ─── Lock / Unlock ────────────────────────────────────────────────────────────

export async function handleLock(message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Manage Channels** permission.")] });
    return;
  }
  try {
    await (message.channel as TextChannel).permissionOverwrites.edit(message.guild.id, { SendMessages: false });
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("🔒 Channel locked. Members cannot send messages.")] });
  } catch {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Failed to lock channel.")] });
  }
}

export async function handleUnlock(message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Manage Channels** permission.")] });
    return;
  }
  try {
    await (message.channel as TextChannel).permissionOverwrites.edit(message.guild.id, { SendMessages: null });
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("🔓 Channel unlocked.")] });
  } catch {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Failed to unlock channel.")] });
  }
}
