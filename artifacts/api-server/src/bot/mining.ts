import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type GuildMember,
  type Message,
} from "discord.js";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, botMiningProfilesTable } from "@workspace/db";
import { logger } from "../lib/logger";

const MINE_COOLDOWN_MS = 30_000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const QUEST_MINE_GOAL = 5;
const QUEST_SELL_GOAL = 200;
const QUEST_REWARD = 250;
const COLOR = 0x2b2d31;

const ORES = [
  { id: "stone", name: "Stone", value: 2, weight: 34 },
  { id: "coal", name: "Coal", value: 5, weight: 24 },
  { id: "copper", name: "Copper", value: 10, weight: 18 },
  { id: "iron", name: "Iron", value: 20, weight: 12 },
  { id: "gold", name: "Gold", value: 45, weight: 7 },
  { id: "crystal", name: "Crystal", value: 100, weight: 3 },
  { id: "diamond", name: "Diamond", value: 250, weight: 1.5 },
  { id: "mythril", name: "Mythril", value: 500, weight: 0.5 },
] as const;

const EXTRA_ITEMS = [
  { id: "fish", name: "River Fish", value: 12 },
  { id: "salmon", name: "Silver Salmon", value: 28 },
  { id: "pearl", name: "River Pearl", value: 120 },
  { id: "meat", name: "Game Meat", value: 18 },
  { id: "hide", name: "Wild Hide", value: 24 },
  { id: "antler", name: "Antler", value: 42 },
  { id: "berries", name: "Wild Berries", value: 8 },
  { id: "herbs", name: "Medicinal Herbs", value: 20 },
  { id: "wood", name: "Timber", value: 10 },
  { id: "rarewood", name: "Ironwood", value: 35 },
  { id: "scrap", name: "Old Scrap", value: 16 },
  { id: "relic", name: "Ancient Relic", value: 180 },
] as const;

const ITEMS = [...ORES, ...EXTRA_ITEMS];
type ItemId = (typeof ITEMS)[number]["id"];
type Profile = typeof botMiningProfilesTable.$inferSelect;
type ToolId = "rod" | "bow" | "sickle" | "axe" | "compass";
type CraftableId = ToolId | "backpack";
const BASE_INVENTORY_CAPACITY = 50;
const BACKPACK_CAPACITY_PER_LEVEL = 50;

function inventoryCapacity(backpackLevel: number): number {
  return BASE_INVENTORY_CAPACITY + backpackLevel * BACKPACK_CAPACITY_PER_LEVEL;
}

function inventoryLoad(inventory: Record<string, number>): number {
  return Object.values(inventory).reduce((total, amount) => total + amount, 0);
}

interface ToolRecipe {
  coins: number;
  items: Partial<Record<ItemId, number>>;
}

const TOOLS: Record<CraftableId, { name: string; recipes: ToolRecipe[] }> = {
  rod: {
    name: "Fishing Rod",
    recipes: [
      { coins: 100, items: { wood: 5, scrap: 2 } },
      { coins: 350, items: { wood: 12, scrap: 5, pearl: 2 } },
      { coins: 1_000, items: { rarewood: 20, scrap: 8, relic: 2 } },
    ],
  },
  bow: {
    name: "Hunting Bow",
    recipes: [
      { coins: 100, items: { wood: 5, hide: 3 } },
      { coins: 450, items: { rarewood: 10, hide: 8, antler: 3 } },
      { coins: 1_200, items: { rarewood: 20, hide: 12, relic: 2 } },
    ],
  },
  sickle: {
    name: "Foraging Sickle",
    recipes: [
      { coins: 80, items: { wood: 4, scrap: 3 } },
      { coins: 300, items: { iron: 6, herbs: 10, rarewood: 3 } },
      { coins: 900, items: { iron: 12, herbs: 15, relic: 2 } },
    ],
  },
  axe: {
    name: "Woodcutter's Axe",
    recipes: [
      { coins: 100, items: { wood: 6, scrap: 3 } },
      { coins: 400, items: { iron: 8, rarewood: 5 } },
      { coins: 1_000, items: { iron: 15, rarewood: 12, relic: 1 } },
    ],
  },
  compass: {
    name: "Explorer's Compass",
    recipes: [
      { coins: 150, items: { scrap: 5, crystal: 2 } },
      { coins: 500, items: { crystal: 6, relic: 2 } },
      { coins: 1_500, items: { crystal: 10, mythril: 2, relic: 4 } },
    ],
  },
  backpack: {
    name: "Backpack",
    recipes: [
      { coins: 200, items: { wood: 10, hide: 5 } },
      { coins: 650, items: { rarewood: 12, hide: 10, scrap: 5 } },
      { coins: 1_500, items: { rarewood: 20, relic: 2, mythril: 1 } },
    ],
  },
};

type ActivityId = "fish" | "hunt" | "forage" | "chop" | "explore";
interface ActivityDrop {
  itemId: ItemId;
  weight: number;
  minAmount: number;
  maxAmount: number;
  rare?: boolean;
}
interface ActivityConfig {
  title: string;
  toolId: ToolId;
  cooldownMs: number;
  experience: number;
  description: string;
  drops: ActivityDrop[];
}

const ACTIVITIES: Record<ActivityId, ActivityConfig> = {
  fish: {
    title: "Fishing",
    toolId: "rod",
    cooldownMs: 45_000,
    experience: 12,
    description: "You cast your line and reel in",
    drops: [
      { itemId: "fish", weight: 70, minAmount: 1, maxAmount: 3 },
      { itemId: "salmon", weight: 24, minAmount: 1, maxAmount: 2, rare: true },
      { itemId: "pearl", weight: 6, minAmount: 1, maxAmount: 1, rare: true },
    ],
  },
  hunt: {
    title: "Hunt",
    toolId: "bow",
    cooldownMs: 60_000,
    experience: 16,
    description: "You track the trail and bring back",
    drops: [
      { itemId: "meat", weight: 50, minAmount: 1, maxAmount: 3 },
      { itemId: "hide", weight: 35, minAmount: 1, maxAmount: 2 },
      { itemId: "antler", weight: 15, minAmount: 1, maxAmount: 1, rare: true },
    ],
  },
  forage: {
    title: "Foraging",
    toolId: "sickle",
    cooldownMs: 35_000,
    experience: 10,
    description: "You search the grove and gather",
    drops: [
      { itemId: "berries", weight: 55, minAmount: 1, maxAmount: 4 },
      { itemId: "herbs", weight: 38, minAmount: 1, maxAmount: 3 },
      { itemId: "crystal", weight: 7, minAmount: 1, maxAmount: 1, rare: true },
    ],
  },
  chop: {
    title: "Woodcutting",
    toolId: "axe",
    cooldownMs: 45_000,
    experience: 12,
    description: "You work the forest edge and cut",
    drops: [
      { itemId: "wood", weight: 82, minAmount: 2, maxAmount: 5 },
      { itemId: "rarewood", weight: 18, minAmount: 1, maxAmount: 2, rare: true },
    ],
  },
  explore: {
    title: "Exploration",
    toolId: "compass",
    cooldownMs: 90_000,
    experience: 20,
    description: "You search the old ruins and uncover",
    drops: [
      { itemId: "scrap", weight: 55, minAmount: 1, maxAmount: 4 },
      { itemId: "relic", weight: 20, minAmount: 1, maxAmount: 1, rare: true },
      { itemId: "crystal", weight: 18, minAmount: 1, maxAmount: 2, rare: true },
      { itemId: "diamond", weight: 7, minAmount: 1, maxAmount: 1, rare: true },
    ],
  },
};

const PICKAXES = [
  { name: "Wooden Pickaxe", cost: 0 },
  { name: "Copper Pickaxe", cost: 500 },
  { name: "Iron Pickaxe", cost: 1_800 },
  { name: "Golden Pickaxe", cost: 5_000 },
  { name: "Crystal Pickaxe", cost: 12_000 },
] as const;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function ensureProfile(guildId: string, userId: string): Promise<Profile> {
  await db
    .insert(botMiningProfilesTable)
    .values({ guildId, userId })
    .onConflictDoNothing();
  const [profile] = await db
    .select()
    .from(botMiningProfilesTable)
    .where(and(eq(botMiningProfilesTable.guildId, guildId), eq(botMiningProfilesTable.userId, userId)))
    .limit(1);
  if (!profile) throw new Error("Could not load mining profile");
  return profile;
}

async function updateProfile(guildId: string, userId: string, values: Partial<typeof botMiningProfilesTable.$inferInsert>): Promise<void> {
  await db
    .update(botMiningProfilesTable)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(botMiningProfilesTable.guildId, guildId), eq(botMiningProfilesTable.userId, userId)));
}

function pickOre(pickaxeLevel: number): (typeof ORES)[number] {
  const weights = ORES.map((ore, index) =>
    ore.weight + (index >= 5 ? (pickaxeLevel - 1) * 0.12 : 0),
  );
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let roll = Math.random() * totalWeight;
  for (let index = 0; index < ORES.length; index += 1) {
    roll -= weights[index] ?? 0;
    if (roll <= 0) return ORES[index] ?? ORES[0];
  }
  return ORES[0];
}

function resetQuestIfNeeded(profile: Profile, today: string): Pick<Profile, "questDate" | "questMines" | "questSellValue" | "questClaimed"> {
  if (profile.questDate === today) {
    return {
      questDate: profile.questDate,
      questMines: profile.questMines,
      questSellValue: profile.questSellValue,
      questClaimed: profile.questClaimed,
    };
  }
  return { questDate: today, questMines: 0, questSellValue: 0, questClaimed: false };
}

function maybeCompleteQuest(
  mines: number,
  sellValue: number,
  alreadyClaimed: boolean,
): { reward: number; claimed: boolean } {
  if (alreadyClaimed || mines < QUEST_MINE_GOAL || sellValue < QUEST_SELL_GOAL) {
    return { reward: 0, claimed: alreadyClaimed };
  }
  return { reward: QUEST_REWARD, claimed: true };
}

function embed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(description);
}

function pickActivityDrop(drops: ActivityDrop[], toolLevel: number): ActivityDrop {
  const weightFor = (drop: ActivityDrop) => drop.weight * (drop.rare ? 1 + toolLevel * 0.65 : 1);
  const totalWeight = drops.reduce((total, drop) => total + weightFor(drop), 0);
  let roll = Math.random() * totalWeight;
  for (const drop of drops) {
    roll -= weightFor(drop);
    if (roll <= 0) return drop;
  }
  const fallback = drops[drops.length - 1];
  if (!fallback) throw new Error("Activity has no possible drops");
  return fallback;
}

async function runGatheringActivity(message: Message, activityId: ActivityId): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const activity = ACTIVITIES[activityId];

  const outcome = await db.transaction(async (tx) => {
    await tx.insert(botMiningProfilesTable).values({ guildId: guild.id, userId: message.author.id }).onConflictDoNothing();
    const [profile] = await tx.select().from(botMiningProfilesTable)
      .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)))
      .for("update");
    if (!profile) throw new Error("Could not load economy profile");

    const now = Date.now();
    const remaining = activity.cooldownMs - (now - (profile.activityCooldowns[activityId] ?? 0));
    const availableSlots = inventoryCapacity(profile.backpackLevel) - inventoryLoad(profile.inventory);
    if (availableSlots <= 0) return { ready: false as const, reason: "full" as const };
    if (remaining > 0) return { ready: false as const, reason: "cooldown" as const, remaining };

    const toolLevel = profile.equipment[activity.toolId] ?? 0;
    const drop = pickActivityDrop(activity.drops, toolLevel);
    const bonusYield = Math.floor(toolLevel / 2);
    const amount = Math.min(
      availableSlots,
      drop.minAmount + Math.floor(Math.random() * (drop.maxAmount - drop.minAmount + 1)) + bonusYield,
    );
    const inventory = { ...profile.inventory, [drop.itemId]: (profile.inventory[drop.itemId] ?? 0) + amount };
    await tx.update(botMiningProfilesTable).set({
      inventory,
      experience: profile.experience + activity.experience,
      activityCooldowns: { ...profile.activityCooldowns, [activityId]: now },
      updatedAt: new Date(),
    }).where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)));

    const item = ITEMS.find((entry) => entry.id === drop.itemId);
    if (!item) throw new Error(`Unknown economy item: ${drop.itemId}`);
    return { ready: true as const, itemName: item.name, amount, experience: activity.experience, toolLevel };
  });

  if (!outcome.ready) {
    await message.reply(outcome.reason === "full"
      ? "🎒 Your backpack is full. Sell or transfer items, or craft a larger backpack with `!craft backpack`."
      : `⏳ You can ${activityId} again <t:${Math.ceil((Date.now() + outcome.remaining) / 1000)}:R>.`);
    return;
  }
  await message.reply({
    embeds: [embed(activity.title, `${activity.description} **${outcome.amount} ${outcome.itemName}**.\n+${outcome.experience} XP${outcome.toolLevel ? `\n${TOOLS[activity.toolId].name} Lv. ${outcome.toolLevel} boosted your rare drop odds.` : ""}`)],
  });
}

type CashActivityId = "work" | "beg" | "crime";
const CASH_ACTIVITIES: Record<CashActivityId, { cooldownMs: number; title: string }> = {
  work: { cooldownMs: 60 * 60_000, title: "Shift complete" },
  beg: { cooldownMs: 10 * 60_000, title: "Street change" },
  crime: { cooldownMs: 15 * 60_000, title: "Risky business" },
};

async function runCashActivity(message: Message, activityId: CashActivityId): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const activity = CASH_ACTIVITIES[activityId];
  const outcome = await db.transaction(async (tx) => {
    await tx.insert(botMiningProfilesTable).values({ guildId: guild.id, userId: message.author.id }).onConflictDoNothing();
    const [profile] = await tx.select().from(botMiningProfilesTable)
      .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)))
      .for("update");
    if (!profile) throw new Error("Could not load economy profile");

    const now = Date.now();
    const remaining = activity.cooldownMs - (now - (profile.activityCooldowns[activityId] ?? 0));
    if (remaining > 0) return { ready: false as const, remaining };

    let coinChange = 0;
    let resultText = "";
    if (activityId === "work") {
      coinChange = 90 + Math.floor(Math.random() * 111);
      resultText = `You finished a shift and earned **${coinChange} coins**.`;
    } else if (activityId === "beg") {
      coinChange = Math.random() < 0.7 ? 10 + Math.floor(Math.random() * 41) : 0;
      resultText = coinChange > 0
        ? `A passerby shared **${coinChange} coins** with you.`
        : "No luck this time. Try again after the cooldown.";
    } else if (Math.random() < 0.55) {
      coinChange = 120 + Math.floor(Math.random() * 281);
      resultText = `The risky job paid off: **+${coinChange} coins**.`;
    } else {
      coinChange = -Math.min(profile.coins, 25 + Math.floor(Math.random() * 76));
      resultText = coinChange < 0
        ? `The plan failed and you lost **${Math.abs(coinChange)} coins**.`
        : "The plan failed, but you had no coins to lose.";
    }

    await tx.update(botMiningProfilesTable).set({
      coins: profile.coins + coinChange,
      experience: profile.experience + 5,
      activityCooldowns: { ...profile.activityCooldowns, [activityId]: now },
      updatedAt: new Date(),
    }).where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)));
    return { ready: true as const, resultText };
  });

  if (!outcome.ready) {
    await message.reply(`⏳ You can try again <t:${Math.ceil((Date.now() + outcome.remaining) / 1000)}:R>.`);
    return;
  }
  await message.reply({ embeds: [embed(activity.title, outcome.resultText)] });
}

async function runCoinFlip(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const wager = /^\d+$/.test(args[1] ?? "") ? Number.parseInt(args[1]!, 10) : 0;
  const guess = args[2]?.toLowerCase();
  if (wager < 1 || wager > 250_000 || (guess !== "heads" && guess !== "tails")) {
    await message.reply("Usage: `!coinflip <1-250000 coins> <heads|tails>`.");
    return;
  }

  const result = await db.transaction(async (tx) => {
    await tx.insert(botMiningProfilesTable).values({ guildId: guild.id, userId: message.author.id }).onConflictDoNothing();
    const [profile] = await tx.select().from(botMiningProfilesTable)
      .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)))
      .for("update");
    if (!profile) throw new Error("Could not load economy profile");
    if (profile.coins < wager) return { played: false as const, coins: profile.coins };

    const landed = Math.random() < 0.5 ? "heads" : "tails";
    const won = landed === guess;
    const stakedBalance = profile.coins - wager;
    const payout = won ? wager * 2 : 0;
    const coins = stakedBalance + payout;
    await tx.update(botMiningProfilesTable).set({ coins, updatedAt: new Date() })
      .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)));
    return { played: true as const, landed, won, payout, coins };
  });

  if (!result.played) {
    await message.reply(`You only have **${result.coins.toLocaleString()} coins**.`);
    return;
  }

  const flipMessage = await message.reply({
    embeds: [embed("Coin flip", `Bet: **${wager.toLocaleString()} coins** on **${guess}**\n\n🪙 The coin is ready...`)],
  });
  const frames = ["🪙", "🌀", "🪙"];
  for (const frame of frames) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    await flipMessage.edit({ embeds: [embed("Coin flip", `Bet: **${wager.toLocaleString()} coins** on **${guess}**\n\n${frame} Flipping...`)] });
  }

  const outcome = result.won
    ? `It landed **${result.landed}**. You won **${result.payout.toLocaleString()} coins** (2× your bet)!`
    : `It landed **${result.landed}**. You lost your **${wager.toLocaleString()}-coin bet**.`;
  await flipMessage.edit({
    embeds: [embed("Coin flip result", `${outcome}\nBalance: **${result.coins.toLocaleString()} coins**.`)],
  });
}

function describeRecipe(recipe: ToolRecipe): string {
  const materials = Object.entries(recipe.items).map(([itemId, amount]) => {
    const item = ITEMS.find((entry) => entry.id === itemId);
    return `${amount} ${item?.name ?? itemId}`;
  });
  return `${recipe.coins} coins${materials.length ? ` + ${materials.join(", ")}` : ""}`;
}

async function handleCraftCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const craftableId = args[1]?.toLowerCase() as CraftableId | undefined;
  const craftable = craftableId ? TOOLS[craftableId] : undefined;

  if (!craftable || !craftableId) {
    const profile = await ensureProfile(guild.id, message.author.id);
    const lines = Object.entries(TOOLS).map(([id, entry]) => {
      const level = id === "backpack" ? profile.backpackLevel : profile.equipment[id] ?? 0;
      const recipe = entry.recipes[level];
      const effect = id === "backpack"
        ? `${inventoryCapacity(level)} inventory slots`
        : `better ${id} rare-drop odds`;
      return recipe
        ? `**${entry.name} Lv. ${level}/3** — ${effect} — ${describeRecipe(recipe)} (\`!craft ${id}\`)`
        : `**${entry.name} Lv. ${level}/3** — fully upgraded`;
    });
    await message.reply({
      embeds: [embed("Workshop", `${lines.join("\n")}\n\nEach tool improves its matching activity's rare-drop odds.`)],
    });
    return;
  }

  const result = await db.transaction(async (tx) => {
    await tx.insert(botMiningProfilesTable).values({ guildId: guild.id, userId: message.author.id }).onConflictDoNothing();
    const [profile] = await tx.select().from(botMiningProfilesTable)
      .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)))
      .for("update");
    if (!profile) throw new Error("Could not load economy profile");

    const level = craftableId === "backpack" ? profile.backpackLevel : profile.equipment[craftableId] ?? 0;
    const recipe = craftable.recipes[level];
    if (!recipe) return { status: "max" as const };
    if (profile.coins < recipe.coins) {
      return { status: "coins" as const, cost: recipe.coins };
    }

    const missing = Object.entries(recipe.items).filter(([itemId, amount]) =>
      (profile.inventory[itemId] ?? 0) < (amount ?? 0),
    );
    if (missing.length > 0) {
      return {
        status: "materials" as const,
        items: missing.map(([itemId, amount]) => {
          const item = ITEMS.find((entry) => entry.id === itemId);
          return `${Math.max(0, (amount ?? 0) - (profile.inventory[itemId] ?? 0))} ${item?.name ?? itemId}`;
        }),
      };
    }

    const inventory = { ...profile.inventory };
    for (const [itemId, amount] of Object.entries(recipe.items)) {
      inventory[itemId] = (inventory[itemId] ?? 0) - (amount ?? 0);
    }
    await tx.update(botMiningProfilesTable).set({
      coins: profile.coins - recipe.coins,
      inventory,
      equipment: craftableId === "backpack"
        ? profile.equipment
        : { ...profile.equipment, [craftableId]: level + 1 },
      backpackLevel: craftableId === "backpack" ? level + 1 : profile.backpackLevel,
      updatedAt: new Date(),
    }).where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)));
    return { status: "crafted" as const, level: level + 1 };
  });

  if (result.status === "max") {
    await message.reply(`${craftable.name} is already fully upgraded.`);
  } else if (result.status === "coins") {
    await message.reply(`You need **${result.cost.toLocaleString()} coins** for the next ${craftable.name} upgrade.`);
  } else if (result.status === "materials") {
    await message.reply(`Missing materials for ${craftable.name}: ${result.items.join(", ")}.`);
  } else {
    const activityName = Object.values(ACTIVITIES).find((activity) => activity.toolId === craftableId)?.title.toLowerCase() ?? "gathering";
    const effect = craftableId === "backpack"
      ? `Your inventory now holds ${inventoryCapacity(result.level)} items.`
      : `Your ${activityName} rare-drop odds improved.`;
    await message.reply({ embeds: [embed("Crafting complete", `Crafted **${craftable.name} Lv. ${result.level}**. ${effect}`)] });
  }
}

async function requestApproval(
  message: Message,
  target: GuildMember,
  description: string,
  onAccept: () => Promise<string>,
): Promise<void> {
  const prompt = await message.reply({
    content: `<@${target.id}> ${description}`,
    allowedMentions: { users: [target.id] },
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("mining:accept").setLabel("Accept").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("mining:decline").setLabel("Decline").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });

  const collector = prompt.createMessageComponentCollector({
    time: 30_000,
    max: 1,
    filter: (interaction) => interaction.user.id === target.id,
  });

  collector.on("collect", async (interaction) => {
    if (interaction.customId === "mining:decline") {
      await interaction.update({ content: "Offer declined.", components: [] });
      return;
    }
    await interaction.deferUpdate();
    try {
      const result = await onAccept();
      await prompt.edit({ content: result, components: [] });
    } catch (err) {
      logger.error({ err, guildId: message.guildId, fromUserId: message.author.id, toUserId: target.id }, "Mining offer failed");
      await prompt.edit({ content: "That offer could not be completed. Your balances and inventory were not changed.", components: [] }).catch(() => {});
    }
  });

  collector.on("end", async (_collected, reason) => {
    if (reason === "time") {
      await prompt.edit({ content: "Offer expired.", components: [] }).catch(() => {});
    }
  });
}

async function transferCoins(guildId: string, fromUserId: string, toUserId: string, amount: number): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.insert(botMiningProfilesTable).values([
      { guildId, userId: fromUserId },
      { guildId, userId: toUserId },
    ]).onConflictDoNothing();
    const profiles = await tx.select().from(botMiningProfilesTable)
      .where(and(eq(botMiningProfilesTable.guildId, guildId), inArray(botMiningProfilesTable.userId, [fromUserId, toUserId])))
      .orderBy(asc(botMiningProfilesTable.userId))
      .for("update");
    const sender = profiles.find((profile) => profile.userId === fromUserId);
    const recipient = profiles.find((profile) => profile.userId === toUserId);
    if (!sender || !recipient) throw new Error("Could not load trade profiles");
    if (sender.coins < amount) return "You don't have enough coins for that transfer.";

    await tx.update(botMiningProfilesTable).set({ coins: sender.coins - amount, updatedAt: new Date() })
      .where(and(eq(botMiningProfilesTable.guildId, guildId), eq(botMiningProfilesTable.userId, fromUserId)));
    await tx.update(botMiningProfilesTable).set({ coins: recipient.coins + amount, updatedAt: new Date() })
      .where(and(eq(botMiningProfilesTable.guildId, guildId), eq(botMiningProfilesTable.userId, toUserId)));
    return `💸 <@${toUserId}> accepted. **${amount.toLocaleString()} coins** transferred from <@${fromUserId}>.`;
  });
}

async function transferItem(guildId: string, fromUserId: string, toUserId: string, itemId: ItemId, amount: number): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.insert(botMiningProfilesTable).values([
      { guildId, userId: fromUserId },
      { guildId, userId: toUserId },
    ]).onConflictDoNothing();
    const profiles = await tx.select().from(botMiningProfilesTable)
      .where(and(eq(botMiningProfilesTable.guildId, guildId), inArray(botMiningProfilesTable.userId, [fromUserId, toUserId])))
      .orderBy(asc(botMiningProfilesTable.userId))
      .for("update");
    const sender = profiles.find((profile) => profile.userId === fromUserId);
    const recipient = profiles.find((profile) => profile.userId === toUserId);
    if (!sender || !recipient) throw new Error("Could not load trade profiles");
    if ((sender.inventory[itemId] ?? 0) < amount) return `You don't have ${amount} ${itemId} to transfer.`;
    const remainingSlots = inventoryCapacity(recipient.backpackLevel) - inventoryLoad(recipient.inventory);
    if (amount > remainingSlots) return `<@${toUserId}>'s backpack only has ${Math.max(0, remainingSlots)} slots free.`;

    await tx.update(botMiningProfilesTable).set({
      inventory: { ...sender.inventory, [itemId]: sender.inventory[itemId]! - amount },
      updatedAt: new Date(),
    }).where(and(eq(botMiningProfilesTable.guildId, guildId), eq(botMiningProfilesTable.userId, fromUserId)));
    await tx.update(botMiningProfilesTable).set({
      inventory: { ...recipient.inventory, [itemId]: (recipient.inventory[itemId] ?? 0) + amount },
      updatedAt: new Date(),
    }).where(and(eq(botMiningProfilesTable.guildId, guildId), eq(botMiningProfilesTable.userId, toUserId)));
    return `🔁 <@${toUserId}> accepted. **${amount} ${itemId}** transferred from <@${fromUserId}>.`;
  });
}

async function resolveDuel(guildId: string, challengerId: string, targetId: string, wager: number): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.insert(botMiningProfilesTable).values([
      { guildId, userId: challengerId },
      { guildId, userId: targetId },
    ]).onConflictDoNothing();
    const profiles = await tx.select().from(botMiningProfilesTable)
      .where(and(eq(botMiningProfilesTable.guildId, guildId), inArray(botMiningProfilesTable.userId, [challengerId, targetId])))
      .orderBy(asc(botMiningProfilesTable.userId))
      .for("update");
    const challenger = profiles.find((profile) => profile.userId === challengerId);
    const target = profiles.find((profile) => profile.userId === targetId);
    if (!challenger || !target) throw new Error("Could not load duel profiles");
    if (challenger.coins < wager || target.coins < wager) return "The duel was cancelled because one player no longer has enough coins for the wager.";

    const winnerId = Math.random() < 0.5 ? challengerId : targetId;
    const loserId = winnerId === challengerId ? targetId : challengerId;
    const winner = winnerId === challengerId ? challenger : target;
    const loser = loserId === challengerId ? challenger : target;
    await tx.update(botMiningProfilesTable).set({ coins: winner.coins + wager, updatedAt: new Date() })
      .where(and(eq(botMiningProfilesTable.guildId, guildId), eq(botMiningProfilesTable.userId, winnerId)));
    await tx.update(botMiningProfilesTable).set({ coins: loser.coins - wager, updatedAt: new Date() })
      .where(and(eq(botMiningProfilesTable.guildId, guildId), eq(botMiningProfilesTable.userId, loserId)));
    return `⚔️ <@${winnerId}> won the duel${wager ? ` and took **${wager.toLocaleString()} coins** from <@${loserId}>` : ""}!`;
  });
}

export async function handleMiningCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const subcommand = args[0]?.toLowerCase() ?? "help";

  try {
    if (Object.hasOwn(ACTIVITIES, subcommand)) {
      await runGatheringActivity(message, subcommand as ActivityId);
      return;
    }

    if (subcommand === "work" || subcommand === "beg" || subcommand === "crime") {
      await runCashActivity(message, subcommand);
      return;
    }

    if (subcommand === "coinflip" || subcommand === "cf" || subcommand === "flip") {
      await runCoinFlip(message, args);
      return;
    }

    if (subcommand === "craft") {
      await handleCraftCommand(message, args);
      return;
    }

    if (subcommand === "mine" || subcommand === "dig") {
      const outcome = await db.transaction(async (tx) => {
        await tx.insert(botMiningProfilesTable).values({ guildId: guild.id, userId: message.author.id }).onConflictDoNothing();
        const [profile] = await tx.select().from(botMiningProfilesTable)
          .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)))
          .for("update");
        if (!profile) throw new Error("Could not load mining profile");

        const now = Date.now();
        const elapsed = now - profile.lastMineAt;
        const availableSlots = inventoryCapacity(profile.backpackLevel) - inventoryLoad(profile.inventory);
        if (availableSlots <= 0) return { cooldown: 0, inventoryFull: true as const };
        if (elapsed < MINE_COOLDOWN_MS) return { cooldown: MINE_COOLDOWN_MS - elapsed, inventoryFull: false as const };

        const ore = pickOre(profile.pickaxeLevel);
        const amount = Math.min(availableSlots, 1 + Math.floor(Math.random() * (profile.pickaxeLevel >= 3 ? 3 : 2)));
        const inventory = { ...profile.inventory, [ore.id]: (profile.inventory[ore.id] ?? 0) + amount };
        const quest = resetQuestIfNeeded(profile, todayUtc());
        const questMines = quest.questMines + 1;
        const completion = maybeCompleteQuest(questMines, quest.questSellValue, quest.questClaimed);

        await tx.update(botMiningProfilesTable).set({
          inventory,
          lastMineAt: now,
          experience: profile.experience + 10,
          coins: profile.coins + completion.reward,
          questDate: quest.questDate,
          questMines,
          questSellValue: quest.questSellValue,
          questClaimed: completion.claimed,
          updatedAt: new Date(),
        }).where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)));

        return { ore: ore.name, amount, cooldown: 0, inventoryFull: false as const, questReward: completion.reward };
      });

      if (outcome.inventoryFull) {
        await message.reply("🎒 Your backpack is full. Sell or transfer items, or craft a larger backpack with `!craft backpack`.");
        return;
      }
      if (outcome.cooldown > 0) {
        await message.reply(`⛏️ You need to wait <t:${Math.ceil((Date.now() + outcome.cooldown) / 1000)}:R> before mining again.`);
        return;
      }
      await message.reply({
        embeds: [embed("Mining result", `You found **${outcome.amount} ${outcome.ore}**!\n+10 XP${outcome.questReward ? `\n\n🎯 Daily quest complete! **+${outcome.questReward} coins**` : ""}`)],
      });
      return;
    }

    if (subcommand === "balance" || subcommand === "bal") {
      const profile = await ensureProfile(guild.id, message.author.id);
      const level = Math.floor(profile.experience / 100) + 1;
      const pickaxe = PICKAXES[profile.pickaxeLevel - 1]?.name ?? PICKAXES[0].name;
      const craftedTools = Object.entries(TOOLS)
        .map(([id, tool]) => id === "backpack"
          ? `${tool.name} Lv. ${profile.backpackLevel} (${inventoryCapacity(profile.backpackLevel)} slots)`
          : `${tool.name} Lv. ${profile.equipment[id] ?? 0}`)
        .join(" • ");
      await message.reply({ embeds: [embed("Mining profile", `**Coins:** ${profile.coins.toLocaleString()}\n**Level:** ${level} (${profile.experience % 100}/100 XP)\n**Pickaxe:** ${pickaxe}\n**Tools:** ${craftedTools}`)] });
      return;
    }

    if (subcommand === "inventory" || subcommand === "inv") {
      const profile = await ensureProfile(guild.id, message.author.id);
      const lines = ITEMS.filter((item) => (profile.inventory[item.id] ?? 0) > 0)
        .map((item) => `**${item.name}:** ${profile.inventory[item.id]}`);
      await message.reply({ embeds: [embed("Adventure inventory", `${inventoryLoad(profile.inventory)}/${inventoryCapacity(profile.backpackLevel)} slots used\n\n${lines.length ? lines.join("\n") : "Your inventory is empty. Try `!mine`, `!fish`, or `!hunt`."}`)] });
      return;
    }

    if (subcommand === "sell") {
      const requestedOre = args[1]?.toLowerCase() ?? "all";
      const rawAmount = args[2];
      const parsedAmount = rawAmount && /^\d+$/.test(rawAmount) ? Number.parseInt(rawAmount, 10) : null;
      if (rawAmount && (parsedAmount === null || parsedAmount < 1)) {
        await message.reply("Enter a positive amount to sell, for example `!mine sell iron 3`.");
        return;
      }
      const result = await db.transaction(async (tx) => {
        await tx.insert(botMiningProfilesTable).values({ guildId: guild.id, userId: message.author.id }).onConflictDoNothing();
        const [profile] = await tx.select().from(botMiningProfilesTable)
          .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)))
          .for("update");
        if (!profile) throw new Error("Could not load mining profile");

        const inventory = { ...profile.inventory };
        const sold: string[] = [];
        let earned = 0;
        for (const item of ITEMS) {
          if (requestedOre !== "all" && requestedOre !== item.id && requestedOre !== item.name.toLowerCase()) continue;
          const available = inventory[item.id] ?? 0;
          const quantity = Math.min(available, parsedAmount ?? available);
          if (quantity < 1) continue;
          inventory[item.id] = available - quantity;
          earned += quantity * item.value;
          sold.push(`${quantity} ${item.name}`);
        }
        const today = todayUtc();
        const quest = resetQuestIfNeeded(profile, today);
        const questSellValue = quest.questSellValue + earned;
        const completion = maybeCompleteQuest(quest.questMines, questSellValue, quest.questClaimed);
        if (earned > 0) {
          await tx.update(botMiningProfilesTable).set({
            inventory,
            coins: profile.coins + earned + completion.reward,
            questDate: quest.questDate,
            questMines: quest.questMines,
            questSellValue,
            questClaimed: completion.claimed,
            updatedAt: new Date(),
          }).where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)));
        }
        return { sold, earned, questReward: completion.reward };
      });

      if (result.earned === 0) {
        await message.reply(requestedOre === "all" ? "You have no ore to sell." : "You don't have any of that ore to sell.");
        return;
      }
      await message.reply({ embeds: [embed("Market sale", `Sold ${result.sold.join(", ")} for **${result.earned.toLocaleString()} coins**.${result.questReward ? `\n🎯 Daily quest complete: **+${result.questReward} coins**` : ""}`)] });
      return;
    }

    if (subcommand === "shop") {
      const profile = await ensureProfile(guild.id, message.author.id);
      const lines = PICKAXES.map((pickaxe, index) => {
        const level = index + 1;
        const status = profile.pickaxeLevel === level ? " • equipped" : profile.pickaxeLevel > level ? " • owned" : ` • ${pickaxe.cost.toLocaleString()} coins`;
        return `**${level}. ${pickaxe.name}**${status}`;
      });
      await message.reply({ embeds: [embed("Pickaxe shop", `${lines.join("\n")}\n\nUpgrade with !mine upgrade.`)] });
      return;
    }

    if (subcommand === "upgrade") {
      const result = await db.transaction(async (tx) => {
        await tx.insert(botMiningProfilesTable).values({ guildId: guild.id, userId: message.author.id }).onConflictDoNothing();
        const [profile] = await tx.select().from(botMiningProfilesTable)
          .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)))
          .for("update");
        if (!profile) throw new Error("Could not load mining profile");
        const nextLevel = profile.pickaxeLevel + 1;
        const nextPickaxe = PICKAXES[nextLevel - 1];
        if (!nextPickaxe) return { error: "max" as const };
        if (profile.coins < nextPickaxe.cost) return { error: "coins" as const, cost: nextPickaxe.cost };
        await tx.update(botMiningProfilesTable).set({
          coins: profile.coins - nextPickaxe.cost,
          pickaxeLevel: nextLevel,
          updatedAt: new Date(),
        }).where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)));
        return { error: null, pickaxe: nextPickaxe.name };
      });
      if (result.error === "max") {
        await message.reply("Your pickaxe is already fully upgraded.");
      } else if (result.error === "coins") {
        await message.reply(`You need **${result.cost.toLocaleString()} coins** for the next pickaxe.`);
      } else {
        await message.reply({ embeds: [embed("Pickaxe upgraded", `You bought the **${result.pickaxe}**! Higher tiers improve your mining yield and rare ore odds.`)] });
      }
      return;
    }

    if (subcommand === "daily") {
      const result = await db.transaction(async (tx) => {
        await tx.insert(botMiningProfilesTable).values({ guildId: guild.id, userId: message.author.id }).onConflictDoNothing();
        const [profile] = await tx.select().from(botMiningProfilesTable)
          .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)))
          .for("update");
        if (!profile) throw new Error("Could not load mining profile");
        const remaining = DAILY_COOLDOWN_MS - (Date.now() - profile.lastDailyAt);
        if (remaining > 0) return { remaining };
        const reward = 100 + profile.pickaxeLevel * 25;
        await tx.update(botMiningProfilesTable).set({
          coins: profile.coins + reward,
          lastDailyAt: Date.now(),
          updatedAt: new Date(),
        }).where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, message.author.id)));
        return { remaining: 0, reward };
      });
      if (result.remaining > 0) {
        await message.reply(`You already claimed today's reward. Come back <t:${Math.ceil((Date.now() + result.remaining) / 1000)}:R>.`);
      } else {
        await message.reply({ embeds: [embed("Daily reward", `You received **${result.reward} coins**.`)] });
      }
      return;
    }

    if (subcommand === "quest" || subcommand === "quests") {
      const profile = await ensureProfile(guild.id, message.author.id);
      const quest = resetQuestIfNeeded(profile, todayUtc());
      const complete = quest.questMines >= QUEST_MINE_GOAL && quest.questSellValue >= QUEST_SELL_GOAL;
      await message.reply({
        embeds: [embed("Daily mining quest", [
          `Mine ore: **${Math.min(quest.questMines, QUEST_MINE_GOAL)}/${QUEST_MINE_GOAL}**`,
          `Sell ore: **${Math.min(quest.questSellValue, QUEST_SELL_GOAL)}/${QUEST_SELL_GOAL} coins**`,
          `Reward: **${QUEST_REWARD} coins**${quest.questClaimed ? " • claimed" : complete ? " • complete" : ""}`,
        ].join("\n"))],
      });
      return;
    }

    if (subcommand === "pay" || subcommand === "give") {
      const target = message.mentions.members?.first();
      if (!target || target.user.bot || target.id === message.author.id) {
        await message.reply(`Mention another member to ${subcommand === "pay" ? "send coins" : "give ore"}.`);
        return;
      }
      if (subcommand === "pay") {
        const amount = /^\d+$/.test(args[2] ?? "") ? Number.parseInt(args[2]!, 10) : 0;
        if (amount < 1 || amount > 1_000_000) {
          await message.reply("Usage: `!mine pay @member <1-1000000 coins>`.");
          return;
        }
        await requestApproval(message, target, `accept **${amount.toLocaleString()} coins** from <@${message.author.id}>?`, () => transferCoins(guild.id, message.author.id, target.id, amount));
        return;
      }

      const item = ITEMS.find((entry) => entry.id === args[2]?.toLowerCase() || entry.name.toLowerCase() === args[2]?.toLowerCase());
      const amount = /^\d+$/.test(args[3] ?? "") ? Number.parseInt(args[3]!, 10) : 0;
      if (!item || amount < 1 || amount > 10_000) {
        await message.reply("Usage: `!mine give @member <item> <1-10000>`.");
        return;
      }
      await requestApproval(message, target, `accept **${amount} ${item.name}** from <@${message.author.id}>?`, () => transferItem(guild.id, message.author.id, target.id, item.id, amount));
      return;
    }

    if (subcommand === "duel") {
      const target = message.mentions.members?.first();
      const wager = args[2] === undefined ? 0 : /^\d+$/.test(args[2]) ? Number.parseInt(args[2], 10) : -1;
      if (!target || target.user.bot || target.id === message.author.id || wager < 0 || wager > 250_000) {
        await message.reply("Usage: `!mine duel @member [0-250000 coin wager]`.");
        return;
      }
      await requestApproval(message, target, `accept a coin-flip duel with <@${message.author.id}>${wager ? ` for **${wager.toLocaleString()} coins**` : ""}?`, () => resolveDuel(guild.id, message.author.id, target.id, wager));
      return;
    }

    if (subcommand === "leaderboard" || subcommand === "top") {
      const leaders = await db.select({ userId: botMiningProfilesTable.userId, coins: botMiningProfilesTable.coins })
        .from(botMiningProfilesTable)
        .where(eq(botMiningProfilesTable.guildId, guild.id))
        .orderBy(desc(botMiningProfilesTable.coins))
        .limit(10);
      const rows = leaders.map((profile, index) => `**${index + 1}.** <@${profile.userId}> — ${profile.coins.toLocaleString()} coins`);
      await message.reply({ embeds: [embed("Mining leaderboard", rows.length ? rows.join("\n") : "No miners yet. Use `!mine mine` to get started.")] });
      return;
    }

    await message.reply({
      embeds: [embed("Economy commands", [
        "Gather: `!mine` `!fish` `!hunt` `!forage` `!chop` `!explore`",
        "Earn: `!work` `!beg` `!crime` `!daily` `!coinflip` / `!cf <bet up to 250000> <heads|tails>`",
        "Manage: `!balance` `!inventory` `!sell <item|all> [amount]` `!shop` `!upgrade` `!craft [tool]`",
        "Progress: `!quest` `!leaderboard`",
        "Players: `!pay @member <coins>` `!give @member <item> <amount>` `!duel @member [wager up to 250000]`",
        "Use `!mine help` for details. Trades and duels require the other player's approval.",
      ].join("\n"))],
    });
  } catch (err) {
    logger.error({ err, guildId: guild.id, userId: message.author.id, subcommand }, "Mining command failed");
    await message.reply("The mining system couldn't complete that command. Please try again.").catch(() => {});
  }
}
