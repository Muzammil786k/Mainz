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
    .setTitle("📖 Help — Page 1/5: 🎉 Giveaway")
    .setDescription("*(Requires **Manage Server** permission)*")
    .addFields(
      { name: "`!gstart <duration> [winners] <prize>`", value: "Start a giveaway.\n**Example:** `!gstart 1d 2 Nitro`\n**Durations:** `30s` `5m` `2h` `1d`" },
      { name: "`!gend <message_id>`", value: "End a running giveaway early." },
      { name: "`!greroll <message_id> [amount]`", value: "Reroll winner(s) of an ended giveaway. Optionally specify how many winners to reroll." },
      { name: "`!help`", value: "Show this help menu." },
    )
    .setFooter({ text: "Page 1 of 5 • Use buttons to navigate" });
}

function page2(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(C)
    .setTitle("📖 Help — Page 2/5: 🛡️ Moderation")
    .addFields(
      { name: "`!warn @user [reason]`", value: "Warn a user (DM + case logged).\n*(Manage Server)*" },
      { name: "`!warnings @user`", value: "View warnings for a user.\n*(Manage Server)*" },
      { name: "`!clearwarnings @user`", value: "Clear all warnings for a user.\n*(Manage Server)*" },
      { name: "`!mute @user <duration> [reason]`", value: "Timeout a user. Case logged.\n**Durations:** `30s` `5m` `2h` `1d` *(max 28d)*\n*(Timeout Members)*" },
      { name: "`!unmute @user`", value: "Remove timeout from a user. Case logged.\n*(Timeout Members)*" },
      { name: "`!kick @user [reason]`", value: "Kick a user. Case logged.\n*(Kick Members)*" },
      { name: "`!ban @user [reason]`", value: "Ban a user. Case logged.\n*(Ban Members)*" },
      { name: "`!unban <user_id>`", value: "Unban a user by ID. Case logged.\n*(Ban Members)*" },
    )
    .setFooter({ text: "Page 2 of 5 • Use buttons to navigate" });
}

function page3(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(C)
    .setTitle("📖 Help — Page 3/5: 📋 Case System")
    .addFields(
      { name: "`!setmodlog #channel`", value: "Set the mod-log channel where all moderation actions are posted automatically.\n*(Manage Server)*" },
      { name: "`!case <id>`", value: "Look up a specific case by its ID.\n*(Manage Server)*" },
      { name: "`!cases [@user]`", value: "View the 10 most recent cases. Mention a user to filter by them.\n*(Manage Server)*" },
    )
    .addFields(
      { name: "\u200b", value: "**Case types:** ⚠️ WARN • 🔇 MUTE • 🔊 UNMUTE • 🥾 KICK • 🔨 BAN • 🔓 UNBAN\nEvery moderation action automatically creates a case and posts it to the mod-log channel (if set)." },
    )
    .setFooter({ text: "Page 3 of 5 • Use buttons to navigate" });
}

function page4(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(C)
    .setTitle("📖 Help — Page 4/5: ⚙️ Channel & Server")
    .addFields(
      { name: "`!nuke`", value: "Delete all messages by cloning the channel.\n⚠️ Asks for confirmation first.\n*(Manage Channels)*" },
      { name: "`!purge <amount>`", value: "Delete last N messages (max 100).\n*(Manage Messages)*" },
      { name: "`!pb <amount>`", value: "Delete last N bot messages.\n*(Manage Messages)*" },
      { name: "`!slowmode <seconds>`", value: "Set slowmode. `0` to disable (max 21600s).\n*(Manage Channels)*" },
      { name: "`!lock`", value: "Lock channel — members can't send messages.\n*(Manage Channels)*" },
      { name: "`!unlock`", value: "Unlock channel.\n*(Manage Channels)*" },
      { name: "`!role @user @role`", value: "Add or remove a role from a user.\n*(Manage Roles)*" },
      { name: "`!nick @user <name | reset>`", value: "Change a user's nickname.\n*(Manage Nicknames)*" },
      { name: "`!announce #channel <message>`", value: "Send an embed announcement to a channel.\n*(Manage Server)*" },
      { name: "`!noprefix [@role | remove]`", value: "Set a role that can skip the `!` prefix.\n*(Manage Server)*" },
    )
    .setFooter({ text: "Page 4 of 5 • Use buttons to navigate" });
}

function page5(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(C)
    .setTitle("📖 Help — Page 5/5: 🎮 Fun & Utility")
    .addFields(
      { name: "💣 **Word Bomb**", value: "\u200b" },
      { name: "`!wordbomb` / `!wb`", value: "Start a Word Bomb game! React ✅ to join.\n**10s** per turn, **2 lives** each. Real English words only!" },
      { name: "`!wbstop`", value: "Stop the current Word Bomb game.\n*(Manage Server)*" },
      { name: "`!wbtop`", value: "Word Bomb win leaderboard for this server." },
      { name: "💤 **AFK**", value: "\u200b" },
      { name: "`!afk [status]`", value: "Set yourself as AFK. Bot notifies anyone who pings you.\nSend any message to remove AFK." },
      { name: "🔍 **Utility**", value: "\u200b" },
      { name: "`!userinfo [@user]`", value: "View info about a user (roles, join date, etc.)." },
      { name: "`!serverinfo`", value: "View info about this server." },
      { name: "`!avatar [@user]`", value: "Get a user's avatar image." },
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
