import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type Message,
} from "discord.js";

const C = 0xff0000;
const TIMEOUT = 60_000;

function page1(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(C)
    .setTitle("📖 Help — Page 1/5: Core & Giveaways")
    .setDescription("Prefix commands and slash commands do the same thing.")
    .addFields(
      { name: "`!help` • `/help`", value: "Show this complete help menu." },
      { name: "`!gstart <duration> [winners] <prize>` • `/gstart`", value: "Start a giveaway. **Example:** `!gstart 1d 2 Nitro`\n**Durations:** `30s` `5m` `2h` `1d`\n*(Manage Server)*" },
      { name: "`!gend <message_id>` • `/gend`", value: "End a running giveaway early.\n*(Manage Server)*" },
      { name: "`!greroll <message_id> [amount]` • `/greroll`", value: "Reroll one or more winners from an ended giveaway.\n*(Manage Server)*" },
      { name: "`!afk [status]` • `/afk`", value: "Set your AFK status. Send any message to remove it." },
    )
    .setFooter({ text: "Page 1 of 5 • Use buttons to navigate" });
}

function page2(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(C)
    .setTitle("📖 Help — Page 2/5: 🛡️ Moderation")
    .addFields(
      { name: "`!warn @user [reason]` • `/warn`", value: "Warn a member, send a DM, and log a case.\n*(Manage Server)*" },
      { name: "`!warnings @user` • `/warnings`", value: "View a member's warnings.\n*(Manage Server)*" },
      { name: "`!clearwarnings @user` • `/clearwarnings`", value: "Clear all warnings for a member.\n*(Manage Server)*" },
      { name: "`!mute @user <duration> [reason]` • `/mute`", value: "Timeout a member. `30s` `5m` `2h` `1d`, max 28 days.\n*(Timeout Members)*" },
      { name: "`!unmute @user` • `/unmute`", value: "Remove a member timeout.\n*(Timeout Members)*" },
      { name: "`!kick @user [reason]` • `/kick`", value: "Kick a member and log a case.\n*(Kick Members)*" },
      { name: "`!ban @user [reason]` • `/ban`", value: "Ban a member and log a case.\n*(Ban Members)*" },
      { name: "`!unban <user_id>` • `/unban`", value: "Unban a user by ID.\n*(Ban Members)*" },
      { name: "`!nuke` • `/nuke`", value: "Clone the channel and delete the old one. Confirmation required.\n*(Manage Channels)*" },
      { name: "`!slowmode <seconds>` • `/slowmode`", value: "Set slowmode from 0 to 21600 seconds.\n*(Manage Channels)*" },
      { name: "`!lock` • `/lock`", value: "Lock the current channel.\n*(Manage Channels)*" },
      { name: "`!unlock` • `/unlock`", value: "Unlock the current channel.\n*(Manage Channels)*" },
      { name: "`!purge <amount>` • `/purge`", value: "Delete 1–100 recent messages.\n*(Manage Messages)*" },
      { name: "`!pb [amount]` • `/pb`", value: "Delete recent bot messages.\n*(Manage Messages)*" },
    )
    .setFooter({ text: "Page 2 of 5 • Use buttons to navigate" });
}

function page3(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(C)
    .setTitle("📖 Help — Page 3/5: 📋 Cases & Server Controls")
    .addFields(
      { name: "`!setmodlog #channel` • `/setmodlog`", value: "Choose where moderation cases are logged.\n*(Manage Server)*" },
      { name: "`!case <id>` • `/case`", value: "Look up one moderation case.\n*(Manage Server)*" },
      { name: "`!cases [@user]` • `/cases`", value: "View the 10 most recent cases, optionally filtered by member.\n*(Manage Server)*" },
      { name: "`!noprefix @role` • `/noprefix`", value: "Let a role use commands without `!`; use `remove` to disable it.\n*(Manage Server)*" },
      { name: "`!role @user @role` • `/role`", value: "Add or remove a role from a member.\n*(Manage Roles)*" },
      { name: "`!nick @user <name|reset>` • `/nick`", value: "Change or reset a member nickname.\n*(Manage Nicknames)*" },
      { name: "`!announce #channel <message>` • `/announce`", value: "Send an announcement embed to a channel.\n*(Manage Server)*" },
      { name: "\u200b", value: "**Case types:** ⚠️ WARN • 🔇 MUTE • 🔊 UNMUTE • 🥾 KICK • 🔨 BAN • 🔓 UNBAN" },
    )
    .setFooter({ text: "Page 3 of 5 • Use buttons to navigate" });
}

function page4(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📖 Help — Page 4/5: 📊 Server & Utility")
    .addFields(
      { name: "`!userinfo [@user]` • `/userinfo`", value: "View member ID, roles, account age, and join date." },
      { name: "`!serverinfo` • `/serverinfo`", value: "View server owner, members, channels, roles, and boosts." },
      { name: "`!mc` / `!membercount` • `/mc`", value: "Show total, humans, bots, online, idle, DND, active, and offline counts." },
      { name: "`!ping` • `/ping`", value: "Show bot WebSocket latency and uptime." },
      { name: "`!botinfo` • `/botinfo`", value: "Show bot tag, server count, latency, and uptime." },
      { name: "`!channelinfo` • `/channelinfo`", value: "Show current channel ID, type, category, and creation time." },
      { name: "`!avatar [@user]` • `/avatar`", value: "Show a member's avatar in high resolution." },
    )
    .setFooter({ text: "Page 4 of 5 • Use buttons to navigate" });
}

function page5(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle("📖 Help — Page 5/5: 🎮 Fun & Games")
    .addFields(
      { name: "💣 **Word Bomb**", value: "\u200b" },
      { name: "`!wordbomb` / `!wb` • `/wordbomb`", value: "Start a Word Bomb game. React ✅ to join.\n**10s** per turn, **2 lives** each. Real English words only!" },
      { name: "`!wbstop` • `/wbstop`", value: "Stop the current Word Bomb game.\n*(Manage Server)*" },
      { name: "`!wbtop` • `/wbtop`", value: "Show the Word Bomb win leaderboard for this server." },
      { name: "✅ **Command notes**", value: "Slash commands appear server-by-server after the bot starts. Prefix commands continue to work as before.\n\nFor accurate online/offline presence counts, enable **Server Members Intent** and **Presence Intent** in the Discord Developer Portal." },
    )
    .setFooter({ text: "Page 5 of 5 • Use buttons to navigate" });
}

const PAGES = [page1, page2, page3, page4, page5];
const TOTAL = PAGES.length;

function buildRow(currentPage: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("help_prev").setLabel("◀ Previous").setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 1),
    new ButtonBuilder().setCustomId("help_page").setLabel(`Page ${currentPage} / ${TOTAL}`).setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId("help_next").setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(currentPage === TOTAL),
  );
}

export async function handleHelp(message: Message): Promise<void> {
  let currentPage = 1;

  const helpMsg = await message.reply({
    embeds: [PAGES[0]()],
    components: [buildRow(currentPage)],
  });

  const collector = helpMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: TIMEOUT,
    filter: (i) => i.user.id === message.author.id,
  });

  collector.on("collect", async (interaction) => {
    if (interaction.customId === "help_prev" && currentPage > 1) currentPage--;
    else if (interaction.customId === "help_next" && currentPage < TOTAL) currentPage++;
    await interaction.update({ embeds: [PAGES[currentPage - 1]()], components: [buildRow(currentPage)] });
  });

  collector.on("end", async () => {
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("help_prev").setLabel("◀ Previous").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("help_page").setLabel(`Page ${currentPage} / ${TOTAL}`).setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId("help_next").setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(true),
    );
    await helpMsg.edit({ components: [disabledRow] }).catch(() => {});
  });
}
