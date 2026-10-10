import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Message,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import {
  botCustomEmbedsTable,
  botEmbedOverridesTable,
  db,
  type CustomEmbedField,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { invalidateEmbedOverrideCache } from "./presentation";

type EditableField = "title" | "description" | "color" | "image" | "thumbnail" | "footer";

function parseColor(value: string): string | null {
  return /^#[\da-f]{6}$/i.test(value) ? value.toUpperCase() : null;
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validName(value: string): boolean {
  return /^[a-z0-9_-]{1,32}$/i.test(value);
}

function embedFromSettings(settings: {
  title: string | null;
  description: string | null;
  color: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  footerText: string | null;
  fields: CustomEmbedField[] | null;
}, fallbackTitle: string): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(settings.title ?? fallbackTitle);
  if (settings.description) embed.setDescription(settings.description);
  if (settings.color) embed.setColor(Number.parseInt(settings.color.slice(1), 16));
  if (settings.imageUrl) embed.setImage(settings.imageUrl);
  if (settings.thumbnailUrl) embed.setThumbnail(settings.thumbnailUrl);
  if (settings.footerText) embed.setFooter({ text: settings.footerText });
  if (settings.fields?.length) embed.addFields(settings.fields);
  return embed;
}

function validateFieldValue(
  field: EditableField,
  value: string,
): { value: string; error?: never } | { value?: never; error: string } {
  if (!value.trim()) return { error: "Value cannot be empty." };
  if (field === "color") {
    const color = parseColor(value.trim());
    return color ? { value: color } : { error: "Use a six-digit hex color, for example `#5865F2`." };
  }
  if (field === "image" || field === "thumbnail") {
    return validUrl(value.trim())
      ? { value: value.trim() }
      : { error: "Use a valid `http://` or `https://` image URL." };
  }
  const limit = field === "title" ? 256 : field === "footer" ? 2048 : 4096;
  return value.length <= limit
    ? { value }
    : { error: `${field} must be ${limit} characters or fewer.` };
}

function toColumn(field: EditableField): string {
  switch (field) {
    case "title": return "title";
    case "description": return "description";
    case "color": return "color";
    case "image": return "imageUrl";
    case "thumbnail": return "thumbnailUrl";
    case "footer": return "footerText";
  }
}

async function saveSettings(
  message: Message,
  kind: "override" | "custom",
  name: string,
  field: EditableField,
  value: string,
): Promise<void> {
  const column = toColumn(field);
  if (kind === "override") {
    await db
      .insert(botEmbedOverridesTable)
      .values({ guildId: message.guild!.id, commandKey: name, [column]: value })
      .onConflictDoUpdate({
        target: [botEmbedOverridesTable.guildId, botEmbedOverridesTable.commandKey],
        set: { [column]: value, updatedAt: new Date() },
      });
    invalidateEmbedOverrideCache(message.guild!.id, name);
    return;
  }
  await db
    .insert(botCustomEmbedsTable)
    .values({ guildId: message.guild!.id, name, [column]: value })
    .onConflictDoUpdate({
      target: [botCustomEmbedsTable.guildId, botCustomEmbedsTable.name],
      set: { [column]: value, updatedAt: new Date() },
    });
}

async function clearSettings(
    message: Message,
    kind: "override" | "custom",
    name: string,
    field: EditableField,
): Promise<void> {
    const column = toColumn(field);
    const guildId = message.guild!.id;
    if (kind === "override") {
      await db
        .update(botEmbedOverridesTable)
        .set({ [column]: null, updatedAt: new Date() })
        .where(and(
          eq(botEmbedOverridesTable.guildId, guildId),
          eq(botEmbedOverridesTable.commandKey, name),
        ));
      invalidateEmbedOverrideCache(guildId, name);
      return;
    }
    await db
      .update(botCustomEmbedsTable)
      .set({ [column]: null, updatedAt: new Date() })
      .where(and(
        eq(botCustomEmbedsTable.guildId, guildId),
        eq(botCustomEmbedsTable.name, name),
      ));
}

async function saveFields(
  message: Message,
  kind: "override" | "custom",
  name: string,
  fields: CustomEmbedField[],
): Promise<void> {
  if (kind === "override") {
    await db
      .insert(botEmbedOverridesTable)
      .values({ guildId: message.guild!.id, commandKey: name, fields })
      .onConflictDoUpdate({
        target: [botEmbedOverridesTable.guildId, botEmbedOverridesTable.commandKey],
        set: { fields, updatedAt: new Date() },
      });
    return;
  }
  await db
    .insert(botCustomEmbedsTable)
    .values({ guildId: message.guild!.id, name, fields })
    .onConflictDoUpdate({
      target: [botCustomEmbedsTable.guildId, botCustomEmbedsTable.name],
      set: { fields, updatedAt: new Date() },
    });
}

export async function handleEmbedCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const member =
    message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need **Manage Server** permission to manage embeds.");
    return;
  }

  const match = /^!embed\s+(\S+)(?:\s+([\s\S]*))?$/i.exec(message.content.trim());
  const action = match?.[1]?.toLowerCase() ?? "help";
  const rest = match?.[2]?.trim() ?? "";

  try {
    if (action === "help") {
      await message.reply(
        "Embed tools:\n" +
        "`!embed new <name>` then `!embed edit <name> <title|description|color|image|thumbnail|footer> <value>`\n" +
        "`!embed field <name> add <field name>|<value>|[inline]`, `!embed field <name> clear`\n" +
        "`!embed show <name>`, `!embed send <name> #channel`, `!embed list`, `!embed delete <name>`\n" +
        "For command embeds: `!embed override <command> <title|description|color|image|thumbnail|footer> <value>`, `!embed override-field <command> add <name>|<value>|[inline]`, `!embed override-show <command>`, `!embed override-clear <command> <field>`, or `!embed override-reset <command>`. Command names can be entered with or without `!`.",
      );
      return;
    }

    if (action === "new") {
      const name = rest.toLowerCase();
      if (!validName(name)) {
        await message.reply("❌ Embed names must be 1–32 letters, numbers, `_` or `-`.");
        return;
      }
      await db
        .insert(botCustomEmbedsTable)
        .values({ guildId: guild.id, name })
        .onConflictDoNothing();
      await message.reply(`✅ Embed \`${name}\` is ready to edit. Use \`!embed edit ${name} title <text>\`.`);
      return;
    }

    if (action === "list") {
      const embeds = await db
        .select({ name: botCustomEmbedsTable.name })
        .from(botCustomEmbedsTable)
        .where(eq(botCustomEmbedsTable.guildId, guild.id));
      await message.reply(
        embeds.length
          ? `Saved embeds: ${embeds.map((embed) => `\`${embed.name}\``).join(", ")}`
          : "ℹ️ No saved custom embeds yet. Start with `!embed new <name>`.",
      );
      return;
    }

    if (action === "edit" || action === "override") {
      const editMatch = /^(\S+)\s+(title|description|color|image|thumbnail|footer)\s+([\s\S]+)$/i.exec(rest);
      if (!editMatch) {
        await message.reply("❌ Usage: `!embed edit <name> <field> <value>` or `!embed override <command> <field> <value>`.");
        return;
      }
      const kind = action === "edit" ? "custom" : "override";
      const name = kind === "override"
        ? editMatch[1]!.replace(/^!|^\//, "").toLowerCase()
        : editMatch[1]!.toLowerCase();
      if (kind === "custom" && !validName(name)) {
        await message.reply("❌ Invalid embed name.");
        return;
      }
      const field = editMatch[2]!.toLowerCase() as EditableField;
      const validated = validateFieldValue(field, editMatch[3]!.trim());
      if ("error" in validated) {
        await message.reply(`❌ ${validated.error}`);
        return;
      }
      await saveSettings(message, kind, name, field, validated.value);
      if (kind === "override") invalidateEmbedOverrideCache(guild.id, name);
      await message.reply(`✅ ${field} updated for ${kind === "custom" ? `embed \`${name}\`` : `!${name} embeds`}.`);
      return;
    }

    if (action === "clear" || action === "override-clear") {
      const clearMatch = /^(\S+)\s+(title|description|color|image|thumbnail|footer)$/i.exec(rest);
      if (!clearMatch) {
        await message.reply("❌ Usage: `!embed clear <name> <field>` or `!embed override-clear <command> <field>`.");
        return;
      }
      const kind = action === "clear" ? "custom" : "override";
      const name = kind === "override"
        ? clearMatch[1]!.replace(/^!|^\//, "").toLowerCase()
        : clearMatch[1]!.toLowerCase();
      if (kind === "custom" && !validName(name)) {
        await message.reply("❌ Invalid embed name.");
        return;
      }
      const field = clearMatch[2]!.toLowerCase() as EditableField;
      await clearSettings(message, kind, name, field);
      await message.reply(`✅ The ${field} customization was cleared.`);
      return;
    }

    if (action === "field" || action === "override-field") {
      const fieldMatch = /^(\S+)\s+(add|clear|remove)(?:\s+([\s\S]+))?$/i.exec(rest);
      if (!fieldMatch) {
        await message.reply("❌ Usage: `!embed field <name> add <name>|<value>|[inline]` or `clear`; command overrides use `!embed override-field <command> ...`.");
        return;
      }
      const kind = action === "field" ? "custom" : "override";
      const name = kind === "override"
        ? fieldMatch[1]!.replace(/^!|^\//, "").toLowerCase()
        : fieldMatch[1]!.toLowerCase();
      if (kind === "custom" && !validName(name)) {
        await message.reply("❌ Invalid embed name.");
        return;
      }
      const table = kind === "custom" ? botCustomEmbedsTable : botEmbedOverridesTable;
      const [saved] = await db
        .select({ fields: table.fields })
        .from(table)
        .where(kind === "custom"
          ? and(eq(botCustomEmbedsTable.guildId, guild.id), eq(botCustomEmbedsTable.name, name))
          : and(eq(botEmbedOverridesTable.guildId, guild.id), eq(botEmbedOverridesTable.commandKey, name)));
      let fields = saved?.fields ?? [];
      const fieldAction = fieldMatch[2]!.toLowerCase();
      if (fieldAction === "clear") {
        fields = [];
      } else if (fieldAction === "remove") {
        const index = Number(fieldMatch[3]);
        if (!Number.isInteger(index) || index < 1 || index > fields.length) {
          await message.reply(`❌ Choose a field number from 1 to ${fields.length}.`);
          return;
        }
        fields = fields.filter((_, fieldIndex) => fieldIndex !== index - 1);
      } else {
        const [fieldName, value, inlineText] = (fieldMatch[3] ?? "").split("|");
        if (!fieldName?.trim() || !value?.trim()) {
          await message.reply("❌ Provide a field as `name|value|inline` (the final `|inline` is optional).");
          return;
        }
        if (fields.length >= 25 || fieldName.length > 256 || value.length > 1024) {
          await message.reply("❌ Embeds allow up to 25 fields; field names are limited to 256 and values to 1024 characters.");
          return;
        }
        const inline = inlineText?.trim().toLowerCase();
        if (inline && inline !== "true" && inline !== "false") {
          await message.reply("❌ The optional inline value must be `true` or `false`.");
          return;
        }
        fields = [...fields, { name: fieldName.trim(), value: value.trim(), ...(inline ? { inline: inline === "true" } : {}) }];
      }
      await saveFields(message, kind, name, fields);
      if (kind === "override") invalidateEmbedOverrideCache(guild.id, name);
      await message.reply(`✅ Embed fields ${fieldAction === "clear" ? "cleared" : fieldAction === "remove" ? "updated" : "updated"}.`);
      return;
    }

    if (action === "show" || action === "override-show") {
      const name = rest.replace(/^!|^\//, "").toLowerCase();
      if (action === "show" && !validName(name)) {
        await message.reply("❌ Invalid embed name.");
        return;
      }
      const [settings] = action === "show"
        ? await db.select().from(botCustomEmbedsTable).where(and(
          eq(botCustomEmbedsTable.guildId, guild.id),
          eq(botCustomEmbedsTable.name, name),
        ))
        : await db.select().from(botEmbedOverridesTable).where(and(
          eq(botEmbedOverridesTable.guildId, guild.id),
          eq(botEmbedOverridesTable.commandKey, name),
        ));
      if (!settings) {
        await message.reply("ℹ️ No saved embed settings were found.");
        return;
      }
      const title = "name" in settings ? name : `!${name}`;
      await message.reply({ embeds: [embedFromSettings(settings, `${title} embed preview`)] });
      return;
    }

    if (action === "send") {
      const sendMatch = /^(\S+)\s+<#(\d{17,20})>$/i.exec(rest);
      if (!sendMatch || !validName(sendMatch[1]!)) {
        await message.reply("❌ Usage: `!embed send <name> #channel`.");
        return;
      }
      const [settings] = await db
        .select()
        .from(botCustomEmbedsTable)
        .where(and(
          eq(botCustomEmbedsTable.guildId, guild.id),
          eq(botCustomEmbedsTable.name, sendMatch[1]!.toLowerCase()),
        ));
      const channel = guild.channels.cache.get(sendMatch[2]!);
      if (!settings || !channel || channel.type !== ChannelType.GuildText || !channel.isSendable()) {
        await message.reply("❌ Embed not found or the target must be a sendable server text channel.");
        return;
      }
      const embed = embedFromSettings(settings, settings.name);
      if (!settings.title && !settings.description && !settings.fields.length && !settings.imageUrl && !settings.thumbnailUrl) {
        await message.reply("❌ Add some content before sending this embed.");
        return;
      }
      await channel.send({ embeds: [embed] });
      await message.reply(`✅ Embed \`${settings.name}\` sent to ${channel}.`);
      return;
    }

    if (action === "delete") {
      const name = rest.toLowerCase();
      if (!validName(name)) {
        await message.reply("❌ Invalid embed name.");
        return;
      }
      const deleted = await db
        .delete(botCustomEmbedsTable)
        .where(and(
          eq(botCustomEmbedsTable.guildId, guild.id),
          eq(botCustomEmbedsTable.name, name),
        ))
        .returning({ name: botCustomEmbedsTable.name });
      await message.reply(deleted.length ? `✅ Embed \`${name}\` deleted.` : "ℹ️ That embed does not exist.");
      return;
    }

    if (action === "override-reset") {
      const name = rest.replace(/^!|^\//, "").toLowerCase();
      if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
        await message.reply("❌ Provide a command name, for example `!embed override-reset ban`.");
        return;
      }
      const deleted = await db
        .delete(botEmbedOverridesTable)
        .where(and(
          eq(botEmbedOverridesTable.guildId, guild.id),
          eq(botEmbedOverridesTable.commandKey, name),
        ))
        .returning({ commandKey: botEmbedOverridesTable.commandKey });
      invalidateEmbedOverrideCache(guild.id, name);
      await message.reply(deleted.length ? `✅ Customizations for !${name} were reset.` : "ℹ️ No customizations were set for that command.");
      return;
    }

    await message.reply("❌ Unknown embed action. Use `!embed` to see available commands.");
  } catch (error) {
    logger.error({ err: error, guildId: guild.id, action }, "Embed customization command failed");
    await message.reply("❌ Could not update embed settings. Please try again.");
  }
}
