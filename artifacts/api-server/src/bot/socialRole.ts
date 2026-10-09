import { PermissionFlagsBits, type Message } from "discord.js";
import { eq } from "drizzle-orm";
import { db, botSocialRoleGateTable } from "@workspace/db";
import { logger } from "../lib/logger";

const CONFIG_CACHE_MS = 15_000;
const roleCache = new Map<string, { expiresAt: number; roleId: string | null }>();
const NO_MENTIONS = { parse: [] as never[], repliedUser: false };

async function getRequiredRoleId(guildId: string): Promise<string | null | undefined> {
  const cached = roleCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.roleId;

  try {
    const [config] = await db
      .select({ roleId: botSocialRoleGateTable.requiredRoleId })
      .from(botSocialRoleGateTable)
      .where(eq(botSocialRoleGateTable.guildId, guildId))
      .limit(1);
    const roleId = config?.roleId ?? null;
    roleCache.set(guildId, { expiresAt: Date.now() + CONFIG_CACHE_MS, roleId });
    return roleId;
  } catch (err) {
    logger.error({ err, guildId }, "Failed to load social role requirement");
    return undefined;
  }
}

export async function canUseSocialCommands(message: Message): Promise<boolean> {
  const guild = message.guild;
  if (!guild) return false;

  const requiredRoleId = await getRequiredRoleId(guild.id);
  if (requiredRoleId === undefined) {
    await message.reply({
      content: "❌ I couldn't verify the social-command role requirement. Please try again shortly.",
      allowedMentions: NO_MENTIONS,
    });
    return false;
  }
  if (!requiredRoleId) return true;

  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (member?.roles.cache.has(requiredRoleId)) return true;

  await message.reply({
    content: `❌ You need the <@&${requiredRoleId}> role to use social commands.`,
    allowedMentions: NO_MENTIONS,
  });
  return false;
}

function parseRoleId(value: string): string | null {
  return /^<@&(\d{17,20})>$/.exec(value)?.[1] ?? (/^\d{17,20}$/.test(value) ? value : null);
}

export async function handleSocialRoleCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const reply = (content: string) => message.reply({ content, allowedMentions: NO_MENTIONS });
  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild) && !member?.permissions.has(PermissionFlagsBits.Administrator)) {
    await reply("❌ You need **Manage Server** permission to configure social commands.");
    return;
  }

  const subcommand = args[0]?.toLowerCase() ?? "status";
  try {
    if (subcommand === "set") {
      const roleId = args[1] ? parseRoleId(args[1]) : null;
      const role = roleId ? await guild.roles.fetch(roleId).catch(() => null) : null;
      if (!role || role.id === guild.id) {
        await reply("❌ Mention a valid server role. Usage: `!socialrole set @role`.");
        return;
      }

      await db
        .insert(botSocialRoleGateTable)
        .values({ guildId: guild.id, requiredRoleId: role.id })
        .onConflictDoUpdate({
          target: botSocialRoleGateTable.guildId,
          set: { requiredRoleId: role.id, updatedAt: new Date() },
        });
      roleCache.set(guild.id, { expiresAt: Date.now() + CONFIG_CACHE_MS, roleId: role.id });
      await reply(`✅ Social commands are now limited to members with ${role}.`);
      return;
    }

    if (subcommand === "remove" || subcommand === "clear" || subcommand === "off") {
      await db.delete(botSocialRoleGateTable).where(eq(botSocialRoleGateTable.guildId, guild.id));
      roleCache.set(guild.id, { expiresAt: Date.now() + CONFIG_CACHE_MS, roleId: null });
      await reply("✅ The social-command role requirement has been removed.");
      return;
    }

    if (subcommand === "status") {
      const roleId = await getRequiredRoleId(guild.id);
      if (roleId === undefined) {
        await reply("❌ Could not read the social-command role setting. Please try again shortly.");
        return;
      }
      await reply(roleId
        ? `🔒 Social commands require <@&${roleId}>. Use ` + "`!socialrole set @role`" + " to change it or " + "`!socialrole remove`" + " to disable the requirement."
        : "🔓 Social commands are available to everyone. Use `!socialrole set @role` to require a role.");
      return;
    }

    await reply("Usage: `!socialrole set @role`, `!socialrole status`, or `!socialrole remove`.");
  } catch (err) {
    logger.error({ err, guildId: guild.id, subcommand }, "Failed to configure social role requirement");
    await reply("❌ Could not update the social-command role setting. Please try again.").catch(() => {});
  }
}
