import {
  ChatInputCommandInteraction,
  Client,
  Collection,
  GuildMember,
  Role,
  SlashCommandBuilder,
  User,
  ChannelType,
  type Message,
} from "discord.js";
import { handleMessage } from "./commands";
import { logger } from "../lib/logger";

const slashCommands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show the complete command help menu."),
  new SlashCommandBuilder()
    .setName("gstart")
    .setDescription("Start a giveaway.")
    .addStringOption((o) => o.setName("duration").setDescription("Duration, e.g. 30s, 5m, 2h, 1d").setRequired(true))
    .addIntegerOption((o) => o.setName("winners").setDescription("Number of winners").setMinValue(1).setMaxValue(20))
    .addStringOption((o) => o.setName("prize").setDescription("Giveaway prize").setRequired(true)),
  new SlashCommandBuilder()
    .setName("gend")
    .setDescription("End a running giveaway.")
    .addStringOption((o) => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true)),
  new SlashCommandBuilder()
    .setName("greroll")
    .setDescription("Reroll giveaway winner(s).")
    .addStringOption((o) => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("Number of winners to reroll").setMinValue(1).setMaxValue(20)),
  new SlashCommandBuilder()
    .setName("afk")
    .setDescription("Set or clear your AFK status.")
    .addStringOption((o) => o.setName("status").setDescription("Optional AFK status")),
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member to warn").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View a member's warnings.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder()
    .setName("clearwarnings")
    .setDescription("Clear a member's warnings.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Timeout a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member to mute").setRequired(true))
    .addStringOption((o) => o.setName("duration").setDescription("Duration, e.g. 30s, 5m, 2h, 1d").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Remove a member timeout.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member to kick").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member to ban").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user by ID.")
    .addStringOption((o) => o.setName("user_id").setDescription("User ID").setRequired(true)),
  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Clone the channel and delete the old one."),
  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set channel slowmode.")
    .addIntegerOption((o) => o.setName("seconds").setDescription("0 to 21600 seconds").setMinValue(0).setMaxValue(21600).setRequired(true)),
  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock the current channel."),
  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock the current channel."),
  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages.")
    .addIntegerOption((o) => o.setName("amount").setDescription("1 to 100 messages").setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder()
    .setName("pb")
    .setDescription("Delete recent bot messages.")
    .addIntegerOption((o) => o.setName("amount").setDescription("1 to 100 messages").setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder()
    .setName("noprefix")
    .setDescription("Configure the no-prefix role.")
    .addRoleOption((o) => o.setName("role").setDescription("Role allowed to omit !"))
    .addBooleanOption((o) => o.setName("remove").setDescription("Remove the current no-prefix role")),
  new SlashCommandBuilder()
    .setName("setmodlog")
    .setDescription("Set the moderation log channel.")
    .addChannelOption((o) => o.setName("channel").setDescription("Moderation log channel").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder()
    .setName("case")
    .setDescription("Look up a moderation case.")
    .addIntegerOption((o) => o.setName("id").setDescription("Case ID").setMinValue(1).setRequired(true)),
  new SlashCommandBuilder()
    .setName("cases")
    .setDescription("View recent moderation cases.")
    .addUserOption((o) => o.setName("user").setDescription("Optional member filter")),
  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View member information.")
    .addUserOption((o) => o.setName("user").setDescription("Optional member")),
  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("View server information."),
  new SlashCommandBuilder()
    .setName("mc")
    .setDescription("Show online, idle, DND, and offline member counts."),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Show bot latency and uptime."),
  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("Show bot information."),
  new SlashCommandBuilder()
    .setName("channelinfo")
    .setDescription("Show current channel information."),
  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a member's avatar.")
    .addUserOption((o) => o.setName("user").setDescription("Optional member")),
  new SlashCommandBuilder()
    .setName("role")
    .setDescription("Add or remove a role.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
  new SlashCommandBuilder()
    .setName("nick")
    .setDescription("Change or reset a member nickname.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("nickname").setDescription("New nickname or reset").setRequired(true)),
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send an announcement embed.")
    .addChannelOption((o) => o.setName("channel").setDescription("Target channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((o) => o.setName("message").setDescription("Announcement text").setRequired(true)),
  new SlashCommandBuilder()
    .setName("wordbomb")
    .setDescription("Start a Word Bomb game."),
  new SlashCommandBuilder()
    .setName("wbstop")
    .setDescription("Stop the current Word Bomb game."),
  new SlashCommandBuilder()
    .setName("wbtop")
    .setDescription("Show the Word Bomb leaderboard."),
].map((command) => command.toJSON());

function mentionContent(interaction: ChatInputCommandInteraction, optionName: string, fallback = ""): string {
  const user = interaction.options.getUser(optionName);
  return user ? `<@${user.id}>` : fallback;
}

function buildLegacyContent(interaction: ChatInputCommandInteraction): string {
  const name = interaction.commandName;
  const string = (option: string) => interaction.options.getString(option) ?? "";
  const integer = (option: string) => interaction.options.getInteger(option);

  switch (name) {
    case "gstart": {
      const winners = integer("winners");
      return `!gstart ${string("duration")}${winners ? ` ${winners}` : ""} ${string("prize")}`;
    }
    case "gend":
      return `!gend ${string("message_id")}`;
    case "greroll": {
      const amount = integer("amount");
      return `!greroll ${string("message_id")}${amount ? ` ${amount}` : ""}`;
    }
    case "afk":
      return `!afk ${string("status")}`.trim();
    case "warn":
      return `!warn ${mentionContent(interaction, "user")} ${string("reason")}`.trim();
    case "warnings":
      return `!warnings ${mentionContent(interaction, "user")}`;
    case "clearwarnings":
      return `!clearwarnings ${mentionContent(interaction, "user")}`;
    case "mute":
      return `!mute ${mentionContent(interaction, "user")} ${string("duration")} ${string("reason")}`.trim();
    case "unmute":
      return `!unmute ${mentionContent(interaction, "user")}`;
    case "kick":
      return `!kick ${mentionContent(interaction, "user")} ${string("reason")}`.trim();
    case "ban":
      return `!ban ${mentionContent(interaction, "user")} ${string("reason")}`.trim();
    case "unban":
      return `!unban ${string("user_id")}`;
    case "slowmode":
      return `!slowmode ${integer("seconds")}`;
    case "purge":
      return `!purge ${integer("amount")}`;
    case "pb":
      return `!pb ${integer("amount") ?? 50}`;
    case "noprefix": {
      if (interaction.options.getBoolean("remove")) return "!noprefix remove";
      const role = interaction.options.getRole("role");
      return role ? `!noprefix <@&${role.id}>` : "!noprefix";
    }
    case "setmodlog": {
      const channel = interaction.options.getChannel("channel");
      return channel ? `!setmodlog <#${channel.id}>` : "!setmodlog";
    }
    case "case":
      return `!case ${integer("id")}`;
    case "cases":
      return `!cases ${mentionContent(interaction, "user")}`.trim();
    case "userinfo":
      return `!userinfo ${mentionContent(interaction, "user")}`.trim();
    case "avatar":
      return `!avatar ${mentionContent(interaction, "user")}`.trim();
    case "role": {
      const role = interaction.options.getRole("role");
      return `!role ${mentionContent(interaction, "user")} ${role ? `<@&${role.id}>` : ""}`.trim();
    }
    case "nick":
      return `!nick ${mentionContent(interaction, "user")} ${string("nickname")}`.trim();
    case "announce": {
      const channel = interaction.options.getChannel("channel");
      return `!announce ${channel ? `<#${channel.id}>` : ""} ${string("message")}`.trim();
    }
    default:
      return `!${name}`;
  }
}

function createMessageAdapter(interaction: ChatInputCommandInteraction, content: string): Message {
  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  const user = interaction.user;
  const selectedUserIds = new Set<string>();
  const selectedUsers = new Collection<string, User>();
  const selectedMembers = new Collection<string, GuildMember>();
  const selectedRoles = new Collection<string, Role>();

  for (const option of ["user"]) {
    const selected = interaction.options.getUser(option);
    if (selected) {
      selectedUserIds.add(selected.id);
      selectedUsers.set(selected.id, selected);
      const selectedMember = interaction.guild?.members.cache.get(selected.id);
      if (selectedMember) selectedMembers.set(selected.id, selectedMember);
    }
  }

  const selectedRole = interaction.options.getRole("role");
  const role = selectedRole ? interaction.guild?.roles.cache.get(selectedRole.id) : undefined;
  if (role) selectedRoles.set(role.id, role);

  const channel = interaction.channel;
  const mentionedChannel = interaction.options.getChannel("channel") ?? channel;
  const selectedChannels = new Collection<string, any>();
  if (mentionedChannel) selectedChannels.set(mentionedChannel.id, mentionedChannel);
  const mentions = {
    users: selectedUsers,
    members: selectedMembers,
    roles: selectedRoles,
    channels: selectedChannels,
  };

  return {
    id: interaction.id,
    content,
    author: user,
    guild: interaction.guild,
    channel,
    member,
    mentions,
    reply: async (payload: unknown) => {
      if (interaction.replied || interaction.deferred) {
        return interaction.followUp(payload as never);
      }
      await interaction.reply(payload as never);
      return interaction.fetchReply();
    },
    delete: async () => {},
  } as unknown as Message;
}

export async function registerSlashCommands(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set(slashCommands);
    } catch (err) {
      logger.error({ err, guildId: guild.id }, "Failed to register slash commands");
    }
  }
  logger.info({ commands: slashCommands.length, guilds: client.guilds.cache.size }, "Slash commands registered");
}

export async function handleSlashCommand(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "❌ This command can only be used inside a server.", ephemeral: true });
    return;
  }

  try {
    const content = buildLegacyContent(interaction);
    const message = createMessageAdapter(interaction, content);
    await handleMessage(client, message);
  } catch (err) {
    logger.error({ err, command: interaction.commandName }, "Error handling slash command");
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "❌ Something went wrong while running that command.", ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: "❌ Something went wrong while running that command.", ephemeral: true }).catch(() => {});
    }
  }
}