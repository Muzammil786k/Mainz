import { EmbedBuilder, PermissionFlagsBits, type Message } from "discord.js";

// guildId -> roleId
const noPrefixRoles = new Map<string, string>();

export function getNoPrefixRole(guildId: string): string | undefined {
  return noPrefixRoles.get(guildId);
}

export function hasNoPrefix(message: Message): boolean {
  if (!message.guild) return false;
  const roleId = noPrefixRoles.get(message.guild.id);
  if (!roleId) return false;
  const member = message.guild.members.cache.get(message.author.id);
  return member?.roles.cache.has(roleId) ?? false;
}

export async function handleNoPrefix(message: Message): Promise<void> {
  if (!message.guild) return;

  const member = message.guild.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setDescription("❌ You need **Manage Server** permission to configure no-prefix."),
      ],
    });
    return;
  }

  const args = message.content.trim().split(/\s+/).slice(1);

  // !noprefix remove
  if (args[0]?.toLowerCase() === "remove") {
    noPrefixRoles.delete(message.guild.id);
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setDescription("✅ No-prefix role has been **removed**. All users must use `!` prefix again."),
      ],
    });
    return;
  }

  const role = message.mentions.roles.first();
  if (!role) {
    const current = noPrefixRoles.get(message.guild.id);
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("⚡ No Prefix")
          .setDescription(
            current
              ? `**Current no-prefix role:** <@&${current}>\n\nUsers with this role can use commands without \`!\`.\n\n` +
                `**Usage:**\n\`!noprefix @role\` — set a role\n\`!noprefix remove\` — remove it`
              : `No no-prefix role is set.\n\n**Usage:**\n\`!noprefix @role\` — set a role\n\`!noprefix remove\` — remove it`
          ),
      ],
    });
    return;
  }

  noPrefixRoles.set(message.guild.id, role.id);
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setDescription(
          `✅ No-prefix role set to <@&${role.id}>.\nMembers with this role can now use commands **without** the \`!\` prefix.`
        ),
    ],
  });
}
