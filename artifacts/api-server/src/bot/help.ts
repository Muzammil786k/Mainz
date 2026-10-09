import {
  EmbedBuilder,
  ActionRowBuilder,
  ComponentType,
  StringSelectMenuBuilder,
  type Message,
} from "discord.js";
import { SOCIAL_ACTIONS, type SocialActionName } from "./social";
import { premiumColors, premiumEmbed } from "./presentation";

const C = premiumColors.brand;
const TIMEOUT = 5 * 60_000;
const HELP_FOOTER = "MAINZ • Select a category below to browse commands";
const CATEGORIES = [
  { label: "Start & Giveaways", value: "start", description: "Help and giveaway commands" },
  { label: "Moderation", value: "moderation", description: "Warnings, timeouts, kicks, and bans" },
  { label: "Cases & Server Controls", value: "controls", description: "Cases, roles, channels, and announcements" },
  { label: "Automation", value: "automation", description: "Auto-reactions, sticky, welcome, goodbye" },
  { label: "Server & Utility", value: "utility", description: "Server info, members, and bot tools" },
  { label: "Games", value: "games", description: "Word Bomb and game commands" },
  { label: "Economy", value: "economy", description: "Mining, gathering, wallet, and trading" },
  { label: "Social: Friendly", value: "friendly", description: "Hugs, cheers, compliments, and more" },
  { label: "Social: Affection", value: "affection", description: "Cute and affectionate reactions" },
  { label: "Social: Reactions", value: "reactions", description: "Anime reactions and playful actions" },
  { label: "Scores & Ships", value: "scores", description: "Aura, rizz, ratings, and ship checks" },
] as const;
type CategoryId = (typeof CATEGORIES)[number]["value"];

function helpPage(title: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(C)
    .setAuthor({ name: "MAINZ  •  COMMAND CENTER" })
    .setTitle(title)
    .setFooter({ text: HELP_FOOTER })
    .setTimestamp();
}

function page1(): EmbedBuilder {
  return helpPage("🧭 Start & Giveaways")
    .setDescription("Your command hub. Prefix and slash commands do the same thing.")
    .addFields(
      { name: "`!help` • `/help`", value: "Show this complete help menu." },
      { name: "`!gstart <duration> [winners] <prize>` • `/gstart`", value: "Start a giveaway. **Example:** `!gstart 1d 2 Nitro`\n**Durations:** `30s` `5m` `2h` `1d`\n*(Manage Server)*" },
      { name: "`!gend <message_id>` • `/gend`", value: "End a running giveaway early.\n*(Manage Server)*" },
      { name: "`!greroll <message_id> [amount]` • `/greroll`", value: "Reroll one or more winners from an ended giveaway.\n*(Manage Server)*" },
      { name: "`!afk [status]` • `/afk`", value: "Set your AFK status. Send any message to remove it." },
    )
    .setFooter({ text: HELP_FOOTER });
}

function page2(): EmbedBuilder {
  return helpPage("🛡️ Moderation")
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
      { name: "`!hide [#channel]` / `!unhide [#channel]`", value: "Hide a channel from @everyone or make it visible again. Use `!unhide #channel` from another channel if hiding it removes your access.\n*(Manage Channels)*" },
      { name: "`!purge <amount>` • `/purge`", value: "Delete 1–100 recent messages.\n*(Manage Messages)*" },
      { name: "`!pb [amount]` • `/pb`", value: "Delete recent bot messages.\n*(Manage Messages)*" },
      { name: "`!automod status`", value: "View filters; configure invites, links, or mentions. Manage words with `!automod add|block <word>` and `!automod remove|unblock <word>`.\n*(Manage Server)*" },
    )
    .setFooter({ text: HELP_FOOTER });
}

function page3(): EmbedBuilder {
  return helpPage("⚙️ Server Controls")
    .addFields(
      { name: "`!setmodlog #channel` • `/setmodlog`", value: "Choose where moderation cases are logged.\n*(Manage Server)*" },
      { name: "`!case <id>` • `/case`", value: "Look up one moderation case.\n*(Manage Server)*" },
      { name: "`!cases [@user]` • `/cases`", value: "View the 10 most recent cases, optionally filtered by member.\n*(Manage Server)*" },
      { name: "`!noprefix @role` • `/noprefix`", value: "Let a role use commands without `!`; use `remove` to disable it.\n*(Manage Server)*" },
      { name: "`!socialrole set @role` • `/socialrole set`", value: "Require a role, such as Level 50, to use social actions like `!kiss` and `!hug`. Check `status` or clear with `remove|clear|off`.\n*(Manage Server)*" },
      { name: "`!role @user @role` • `/role`", value: "Add or remove a role from a member.\n*(Manage Roles)*" },
      { name: "`!nick @user <name|reset>` • `/nick`", value: "Change or reset a member nickname.\n*(Manage Nicknames)*" },
      { name: "`!announce #channel <message>` • `/announce`", value: "Send an announcement embed to a channel.\n*(Manage Server)*" },
      { name: "`!vc help` • `!vc <subcommand>`", value: "Manage your temporary voice channel: `lock` `unlock` `hide` `show` `limit <n>` `name <name>` `transfer|owner @user` `permit @user` `reject @user` `kick @user` `pull|move @user` `claim` `info`.\n*(Channel owner; `info` and `claim` are open to members in the channel)*" },
      { name: "`!jtc set #lobby [#category]` • `/jtc set`", value: "Choose the Join to Create lobby voice channel and optional category.\n*(Manage Server)*" },
      { name: "`!jtc remove|disable` • `!jtc status` • `/jtc`", value: "Turn off Join to Create, or show the configured lobby and category.\n*(Manage Server)*" },
      { name: "`!ticket help` • `!ticket new|open`", value: "Show ticket help or open a private support ticket." },
      { name: "`!ticket close [reason]`", value: "Close your ticket; staff can close any ticket." },
      { name: "`!ticket setup|set|config #category` • `!ticket status`", value: "Configure or inspect the ticket category.\n*(Manage Server for setup)*" },
      { name: "\u200b", value: "**Case types:** ⚠️ WARN • 🔇 MUTE • 🔊 UNMUTE • 🥾 KICK • 🔨 BAN • 🔓 UNBAN" },
    )
    .setFooter({ text: HELP_FOOTER });
}

function page4(): EmbedBuilder {
  return helpPage("🧰 Server & Utility")
    .addFields(
      { name: "`!userinfo [@user]` • `/userinfo`", value: "View member ID, roles, account age, and join date." },
      { name: "`!serverinfo` • `/serverinfo`", value: "View server owner, members, channels, roles, and boosts." },
      { name: "`!mc` / `!membercount` • `/mc`", value: "Show total, humans, bots, online, idle, DND, active, and offline counts." },
      { name: "`!ping` • `/ping`", value: "Show bot WebSocket latency and uptime." },
      { name: "`!botinfo` • `/botinfo`", value: "Show bot tag, server count, latency, and uptime." },
      { name: "`!channelinfo` • `/channelinfo`", value: "Show current channel ID, type, category, and creation time." },
      { name: "`!avatar [@user]` • `/avatar`", value: "Show a member's avatar in high resolution." },
      { name: "`!steal` (reply to an emoji or sticker)", value: "Choose to add an emoji or PNG/APNG/GIF sticker from the replied-to message as a server emoji or sticker. Lottie stickers are converted to a still image. Requires **Create Expressions** permission and an available slot." },
    )
    .setFooter({ text: HELP_FOOTER });
}

function pageAutomation(): EmbedBuilder {
  return helpPage("📡 Automation")
    .setDescription("Configure these features with **Manage Server** permission.")
    .addFields(
      { name: "`!autoreact set #channel <:emoji:id>` • `/autoreact set`", value: "React to every new message in that channel with one custom emoji from this server." },
      { name: "`!autoreact status #channel` • `/autoreact status`", value: "Show the active reaction for a channel." },
      { name: "`!autoreact remove #channel` • `/autoreact remove`", value: "Turn off auto-react for a channel." },
      { name: "`!sticky set #channel <message>` • `/sticky set`", value: "Keep one branded message at the bottom of a channel. It moves after new messages." },
      { name: "`!sticky remove #channel` • `/sticky remove`", value: "Remove the sticky message and stop reposting it." },
      { name: "`!welcome set #channel <message>` • `/welcome set`", value: "Post a branded welcome when a member joins. Use `{user}`, `{server}`, or `{memberCount}`." },
      { name: "`!welcome remove` • `/welcome remove`", value: "Turn off welcome messages." },
      { name: "`!goodbye set #channel <message>` • `/goodbye set`", value: "Post a branded goodbye when a member leaves. Supports the same placeholders." },
      { name: "`!goodbye remove` • `/goodbye remove`", value: "Turn off goodbye messages." },
    )
    .setFooter({ text: HELP_FOOTER });
}

function page5(): EmbedBuilder {
  return helpPage("🎮 Games")
    .addFields(
      { name: "💣 **Word Bomb**", value: "\u200b" },
      { name: "`!wordbomb` / `!wb` • `/wordbomb`", value: "Start a Word Bomb game. React ✅ to join.\n**10s** per turn, **3 lives** each. Real English words only!" },
      { name: "`!wbstop` / `!wordbomb stop` • `/wbstop`", value: "Stop the current Word Bomb game.\n*(Manage Server)*" },
      { name: "`!wbtop` • `/wbtop`", value: "Show the Word Bomb win leaderboard for this server." },
      { name: "✅ **Command notes**", value: "Slash commands appear server-by-server after the bot starts. Prefix commands continue to work as before.\n\nFor accurate online/offline presence counts, enable **Server Members Intent** and **Presence Intent** in the Discord Developer Portal." },
    )
    .setFooter({ text: HELP_FOOTER });
}

function pageEconomy(): EmbedBuilder {
  return helpPage("💰 Economy")
    .addFields(
      { name: "⛏️ **Gathering games**", value: "`!mine` — ores\n`!fish` — fishing\n`!hunt` — hunting\n`!forage` — berries and herbs\n`!chop` — woodcutting\n`!explore` — find salvage and relics" },
      { name: "💼 **Earn coins**", value: "`!work` — hourly shift\n`!beg` — ask for change\n`!crime` — risky payout\n`!coinflip` / `!cf <bet up to 250000> <heads|tails>`" },
      { name: "🪙 **Wallet, market & crafting**", value: "`!balance` `!inventory` `!sell <item|all> [amount]`\n`!daily` — claim daily coins\n`!mine shop` `!upgrade`\n`!craft [tool]` — craft a rod, bow, sickle, axe, compass, or backpack" },
      { name: "🏷️ **Role shop**", value: "`!shop` — browse numbered role/price pages\n`!shop buy @role` — buy with coins\n`!shop add @role <price>` — add a listing\n`!shop edit @role <new-price>` — edit its price\n`!shop remove @role` — remove a listing (**Manage Server**)" },
      { name: "🎯 **Progress & players**", value: "`!quest` `!leaderboard`\n`!pay @member <coins>` `!give @member <item> <amount>`\n`!duel @member [wager up to 250000]`\nTransfers and duels require the other member's approval." },
    )
    .setFooter({ text: HELP_FOOTER });
}

const FRIENDLY_ACTIONS: SocialActionName[] = [
  "hug",
  "highfive",
  "wave",
  "smile",
  "cheer",
  "compliment",
];
const AFFECTION_ACTIONS: SocialActionName[] = [
  "kiss",
  "bite",
  "pat",
  "cuddle",
  "boop",
  "handhold",
  "blush",
  "feed",
  "nom",
  "pout",
];
const REACTION_ACTIONS: SocialActionName[] = [
  "kill",
  "slap",
  "poke",
  "bonk",
  "dance",
  "punch",
  "cry",
  "facepalm",
  "roast",
  "cartoonkick",
  "laugh",
  "shrug",
  "smug",
  "stare",
  "think",
  "tickle",
  "wink",
  "yeet",
  "clap",
];

function socialCategory(
  title: string,
  actionNames: SocialActionName[],
  includeShip = false,
): EmbedBuilder {
  const fields = actionNames.map((name) => ({
    name: `\`!${name} @user\` • \`/${name} user\``,
    value: SOCIAL_ACTIONS[name].help,
  }));
  if (includeShip) {
    fields.push({
      name: "`!ship @user1 @user2` • `/ship user1 user2`",
      value: "Get a playful compatibility score for two members. No one gets pinged.",
    });
  }

  return new EmbedBuilder()
    .setColor(C)
    .setAuthor({ name: "MAINZ  •  COMMAND CENTER" })
    .setTitle(`📖 Help • ${title}`)
    .setDescription("Prefix and slash commands do the same thing. Social commands can be role-restricted with `!socialrole set @role`.")
    .addFields(...fields)
    .setFooter({ text: HELP_FOOTER });
}

const CATEGORY_BUILDERS: Record<CategoryId, () => EmbedBuilder> = {
  start: page1,
  moderation: page2,
  controls: page3,
  automation: pageAutomation,
  utility: page4,
  games: page5,
  economy: pageEconomy,
  friendly: () => socialCategory("Social: Friendly", FRIENDLY_ACTIONS),
  affection: () => socialCategory("Social: Affection", AFFECTION_ACTIONS),
  reactions: () => socialCategory("Social: Reactions", REACTION_ACTIONS),
  scores: () => socialCategory("Scores & Ships", ["aura", "rizz", "vibecheck", "rate"], true),
};

function buildCategoryRow(selected: CategoryId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("help_category")
    .setPlaceholder("Choose a help category")
    .addOptions(
      CATEGORIES.map((category) => ({
        label: category.label,
        value: category.value,
        description: category.description,
        default: category.value === selected,
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export async function handleHelp(message: Message): Promise<void> {
  let currentCategory: CategoryId = "start";

  const helpMsg = await message.reply({
    embeds: [CATEGORY_BUILDERS[currentCategory]()],
    components: [buildCategoryRow(currentCategory)],
  });

  const collector = helpMsg.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    time: TIMEOUT,
  });

  collector.on("collect", async (interaction) => {
    if (interaction.user.id !== message.author.id) {
      await interaction.reply({
        embeds: [
          premiumEmbed(
            "Only the person who opened this help menu can change its category.",
            { title: "Help menu" },
            message.client?.user,
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    const selected = CATEGORIES.find((category) => category.value === interaction.values[0]);
    if (!selected) {
      await interaction.deferUpdate();
      return;
    }

    currentCategory = selected.value;
    await interaction.update({
      embeds: [CATEGORY_BUILDERS[currentCategory]()],
      components: [buildCategoryRow(currentCategory)],
    });
  });

  collector.on("end", async () => {
    await helpMsg.edit({ components: [] }).catch(() => {});
  });
}
