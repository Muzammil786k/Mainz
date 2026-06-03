import {
  EmbedBuilder,
  PermissionFlagsBits,
  type Message,
  type TextChannel,
} from "discord.js";

const C = 0xff0000;

// ─── User Info ─────────────────────────────────────────────────────────────────

export async function handleUserInfo(message: Message): Promise<void> {
  if (!message.guild) return;
  const target =
    message.mentions.members?.first() ??
    message.guild.members.cache.get(message.content.trim().split(/\s+/)[1] ?? "") ??
    message.guild.members.cache.get(message.author.id)!;

  if (!target) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Could not find that member.")] });
    return;
  }

  const roles = target.roles.cache
    .filter((r) => r.id !== message.guild!.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => `<@&${r.id}>`)
    .slice(0, 10)
    .join(", ") || "None";

  const joinedAt = target.joinedAt ? `<t:${Math.floor(target.joinedAt.getTime() / 1000)}:F>` : "Unknown";
  const createdAt = `<t:${Math.floor(target.user.createdAt.getTime() / 1000)}:F>`;

  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(C)
        .setTitle(`👤 ${target.user.username}`)
        .setThumbnail(target.user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: "Display Name", value: target.displayName, inline: true },
          { name: "ID", value: target.id, inline: true },
          { name: "Bot", value: target.user.bot ? "Yes" : "No", inline: true },
          { name: "Account Created", value: createdAt, inline: false },
          { name: "Joined Server", value: joinedAt, inline: false },
          { name: `Roles (${target.roles.cache.size - 1})`, value: roles, inline: false },
        )
        .setFooter({ text: `Requested by ${message.author.username}` })
        .setTimestamp(),
    ],
  });
}

// ─── Server Info ───────────────────────────────────────────────────────────────

export async function handleServerInfo(message: Message): Promise<void> {
  if (!message.guild) return;
  const guild = message.guild;
  await guild.members.fetch().catch(() => {});

  const owner = await guild.fetchOwner().catch(() => null);
  const createdAt = `<t:${Math.floor(guild.createdAt.getTime() / 1000)}:F>`;
  const humans = guild.members.cache.filter((m) => !m.user.bot).size;
  const bots = guild.members.cache.filter((m) => m.user.bot).size;

  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(C)
        .setTitle(`🏠 ${guild.name}`)
        .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
        .addFields(
          { name: "Owner", value: owner ? `<@${owner.id}>` : "Unknown", inline: true },
          { name: "Server ID", value: guild.id, inline: true },
          { name: "Created", value: createdAt, inline: false },
          { name: "Members", value: `👥 **${guild.memberCount}** total | 👤 ${humans} humans | 🤖 ${bots} bots`, inline: false },
          { name: "Channels", value: `${guild.channels.cache.size}`, inline: true },
          { name: "Roles", value: `${guild.roles.cache.size}`, inline: true },
          { name: "Boost Level", value: `Level ${guild.premiumTier}`, inline: true },
        )
        .setFooter({ text: `Requested by ${message.author.username}` })
        .setTimestamp(),
    ],
  });
}

// ─── Avatar ────────────────────────────────────────────────────────────────────

export async function handleAvatar(message: Message): Promise<void> {
  const target =
    message.mentions.users.first() ??
    (message.guild?.members.cache.get(message.content.trim().split(/\s+/)[1] ?? "")?.user) ??
    message.author;

  const avatarUrl = target.displayAvatarURL({ size: 1024 });

  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(C)
        .setTitle(`🖼️ ${target.username}'s Avatar`)
        .setImage(avatarUrl)
        .setDescription(`[Open in browser](${avatarUrl})`),
    ],
  });
}

// ─── Role ──────────────────────────────────────────────────────────────────────

export async function handleRole(message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Manage Roles** permission.")] });
    return;
  }

  const target = message.mentions.members?.first();
  const role = message.mentions.roles.first();

  if (!target || !role) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Usage: `!role @user @role`")] });
    return;
  }

  if (role.position >= mod.roles.highest.position) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You cannot manage a role higher than or equal to your own.")] });
    return;
  }

  try {
    if (target.roles.cache.has(role.id)) {
      await target.roles.remove(role);
      await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription(`✅ Removed role <@&${role.id}> from **${target.displayName}**.`)] });
    } else {
      await target.roles.add(role);
      await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription(`✅ Added role <@&${role.id}> to **${target.displayName}**.`)] });
    }
  } catch {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Failed to manage that role. Check my permissions and role hierarchy.")] });
  }
}

// ─── Nickname ──────────────────────────────────────────────────────────────────

export async function handleNick(message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.ManageNicknames)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Manage Nicknames** permission.")] });
    return;
  }

  const args = message.content.trim().split(/\s+/).slice(1);
  const target = message.mentions.members?.first();

  if (!target) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Usage: `!nick @user <new nickname>` or `!nick @user reset`")] });
    return;
  }

  const nick = args.slice(1).join(" ");
  const newNick = nick.toLowerCase() === "reset" ? null : nick || null;

  try {
    await target.setNickname(newNick);
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(C)
          .setDescription(
            newNick
              ? `✅ Changed **${target.user.username}**'s nickname to **${newNick}**.`
              : `✅ Reset **${target.user.username}**'s nickname.`
          ),
      ],
    });
  } catch {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Failed to change nickname. Check my role hierarchy.")] });
  }
}

// ─── Announce ──────────────────────────────────────────────────────────────────

export async function handleAnnounce(message: Message): Promise<void> {
  if (!message.guild) return;
  const mod = message.guild.members.cache.get(message.author.id);
  if (!mod?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ You need **Manage Server** permission.")] });
    return;
  }

  const args = message.content.trim().split(/\s+/).slice(1);
  const targetChannel = message.mentions.channels.first() as TextChannel | undefined;

  if (!targetChannel || args.length < 2) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Usage: `!announce #channel <message>`")] });
    return;
  }

  const text = args.slice(1).join(" ");
  if (!text) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription("❌ Please provide a message to announce.")] });
    return;
  }

  await targetChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(C)
        .setDescription(text)
        .setFooter({ text: `Announced by ${message.author.username}` })
        .setTimestamp(),
    ],
  });

  await message.reply({ embeds: [new EmbedBuilder().setColor(C).setDescription(`✅ Announcement sent to ${targetChannel}.`)] });
}
