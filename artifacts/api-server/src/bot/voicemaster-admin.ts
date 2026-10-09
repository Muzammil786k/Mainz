import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Message,
} from "discord.js";
import { logger } from "../lib/logger";
import {
  DEFAULT_NAME_TEMPLATE,
  defaultLimitByGuild,
  hubsByGuild,
  templateByGuild,
} from "./joinToCreate";

const MAX_TEMPLATE_LENGTH = 100;

const VM_USAGE = [
  "Usage:",
  "`!vm setup` — create the VoiceMaster category, hub, and interface channel",
  "`!vm add #voice` — use an existing voice channel as a hub",
  "`!vm removehub #voice` — stop using a channel as a hub",
  "`!vm hubs` — list configured hubs",
  "`!vm default <template>` — set the channel name template (`{user}`, `{count}`)",
  "`!vm limit <0-99>` — set the default user limit for new channels",
].join("\n");

export async function handleVmCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) {
    await message.reply("This command can only be used in a server.");
    return;
  }

  if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need the **Manage Server** permission to use this command.");
    return;
  }

  const sub = args[0]?.toLowerCase() ?? "";

  try {
    switch (sub) {
      case "setup": {
        const category = await guild.channels.create({
          name: "VoiceMaster",
          type: ChannelType.GuildCategory,
        });
        const hub = await guild.channels.create({
          name: "Join to Create",
          type: ChannelType.GuildVoice,
          parent: category.id,
        });
        const iface = await guild.channels.create({
          name: "interface",
          type: ChannelType.GuildText,
          parent: category.id,
        });

        addHub(guild.id, hub.id);
        logger.info(
          { guildId: guild.id, categoryId: category.id, hubId: hub.id, interfaceId: iface.id },
          "VoiceMaster setup completed",
        );

        const embed = new EmbedBuilder()
          .setTitle("VoiceMaster Setup Complete")
          .setDescription(
            [
              `Category: <#${category.id}> (\`${category.id}\`)`,
              `Hub: <#${hub.id}> (\`${hub.id}\`)`,
              `Interface: <#${iface.id}> (\`${iface.id}\`)`,
              "",
              "Join the hub channel to get your own voice channel.",
            ].join("\n"),
          );
        await message.reply({ embeds: [embed] });
        return;
      }

      case "add": {
        const channel = message.mentions.channels.first();
        if (!channel || channel.type !== ChannelType.GuildVoice || channel.guildId !== guild.id) {
          await message.reply("Mention a voice channel in this server, e.g. `!vm add #Join-to-Create`.");
          return;
        }
        addHub(guild.id, channel.id);
        await message.reply(`✅ <#${channel.id}> is now a Join to Create hub.`);
        return;
      }

      case "removehub": {
        const channel = message.mentions.channels.first();
        if (!channel) {
          await message.reply("Mention the hub voice channel, e.g. `!vm removehub #Join-to-Create`.");
          return;
        }
        const hubs = hubsByGuild.get(guild.id);
        if (!hubs?.delete(channel.id)) {
          await message.reply("That channel is not a configured hub.");
          return;
        }
        if (hubs.size === 0) hubsByGuild.delete(guild.id);
        await message.reply(`🗑️ <#${channel.id}> is no longer a hub.`);
        return;
      }

      case "hubs": {
        const hubs = [...(hubsByGuild.get(guild.id) ?? [])];
        const envHub = process.env["JTC_LOBBY_CHANNEL_ID"];
        if (envHub && !hubs.includes(envHub) && guild.channels.cache.has(envHub)) hubs.push(envHub);

        const template = templateByGuild.get(guild.id) ?? DEFAULT_NAME_TEMPLATE;
        const limit = defaultLimitByGuild.get(guild.id) ?? 0;
        const embed = new EmbedBuilder()
          .setTitle("VoiceMaster Hubs")
          .setDescription(hubs.length > 0 ? hubs.map((id) => `<#${id}> (\`${id}\`)`).join("\n") : "No hubs configured. Use `!vm setup` or `!vm add #voice`.")
          .addFields(
            { name: "Name template", value: `\`${template}\``, inline: true },
            { name: "Default limit", value: limit === 0 ? "None" : String(limit), inline: true },
          );
        await message.reply({ embeds: [embed] });
        return;
      }

      case "default": {
        const template = args.slice(1).join(" ").trim();
        if (!template) {
          await message.reply("Provide a name template, e.g. `!vm default {user}'s channel`. Placeholders: `{user}`, `{count}`.");
          return;
        }
        if (template.length > MAX_TEMPLATE_LENGTH) {
          await message.reply(`Templates can be at most ${MAX_TEMPLATE_LENGTH} characters.`);
          return;
        }
        templateByGuild.set(guild.id, template);
        await message.reply(`✅ Channel name template set to \`${template}\`.`);
        return;
      }

      case "limit": {
        const raw = args[1] ?? "";
        const limit = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
        if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
          await message.reply("Provide a default user limit between 0 and 99 (0 means no limit).");
          return;
        }
        defaultLimitByGuild.set(guild.id, limit);
        await message.reply(limit === 0 ? "✅ Default user limit removed." : `✅ Default user limit set to ${limit}.`);
        return;
      }

      default:
        await message.reply(VM_USAGE);
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id, sub }, "Failed to run !vm command");
    await message.reply("Something went wrong running that command. Check that I have **Manage Channels** permission.").catch(() => {});
  }
}

function addHub(guildId: string, channelId: string): void {
  const hubs = hubsByGuild.get(guildId) ?? new Set<string>();
  hubs.add(channelId);
  hubsByGuild.set(guildId, hubs);
}
