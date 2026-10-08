import { AttachmentBuilder, EmbedBuilder, type Message } from "discord.js";
import { logger } from "../lib/logger";
import { renderShipImage } from "./shipImage";

interface SocialAction {
  description: string;
  title: string;
  help: string;
  gifCategory: string;
  render: (actor: string, target: string, targetId: string) => string;
}

function seededScore(seed: string, min: number, max: number): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return min + ((hash >>> 0) % (max - min + 1));
}

function dailyScore(kind: string, targetId: string, min: number, max: number): number {
  const day = new Date().toISOString().slice(0, 10);
  return seededScore(`${kind}:${targetId}:${day}`, min, max);
}

export const SOCIAL_ACTIONS = {
  hug: {
    description: "Give a member a warm hug.",
    title: "🫂 Hug!",
    help: "Send someone a warm hug.",
    gifCategory: "hug",
    render: (actor, target) => `${actor} gives ${target} a big, warm hug!`,
  },
  kiss: {
    description: "Send a friendly kiss to a member.",
    title: "😘 Friendly kiss!",
    help: "Send someone a friendly, non-romantic kiss.",
    gifCategory: "kiss",
    render: (actor, target) => `${actor} sends ${target} a friendly kiss!`,
  },
  bite: {
    description: "Playfully nibble a member.",
    title: "😬 Playful bite!",
    help: "Give someone a playful cartoon nibble.",
    gifCategory: "bite",
    render: (actor, target) => `${actor} gives ${target} a silly cartoon nibble!`,
  },
  kill: {
    description: "Pretend to defeat a member in a silly game.",
    title: "🎮 Game over!",
    help: "Pretend to defeat someone in a harmless game-style showdown.",
    gifCategory: "yeet",
    render: (actor, target) => `${actor} defeats ${target} in a silly game-style showdown. Respawn in 3… 2… 1!`,
  },
  slap: {
    description: "Give a member a light cartoon-style slap.",
    title: "🖐️ Cartoon slap!",
    help: "Give someone a harmless, cartoon-style slap.",
    gifCategory: "slap",
    render: (actor, target) => `${actor} gives ${target} a harmless cartoon-style slap!`,
  },
  pat: {
    description: "Give a member a gentle head pat.",
    title: "🐾 Head pat!",
    help: "Give someone a gentle head pat.",
    gifCategory: "pat",
    render: (actor, target) => `${actor} gives ${target} a gentle head pat.`,
  },
  cuddle: {
    description: "Cuddle up with a member.",
    title: "🧸 Cuddle!",
    help: "Share a cozy cuddle with someone.",
    gifCategory: "cuddle",
    render: (actor, target) => `${actor} cuddles up with ${target}. Cozy mode: activated!`,
  },
  highfive: {
    description: "Give a member a high-five.",
    title: "🙌 High-five!",
    help: "Give someone a high-five.",
    gifCategory: "highfive",
    render: (actor, target) => `${actor} gives ${target} a high-five!`,
  },
  wave: {
    description: "Wave hello to a member.",
    title: "👋 Hello!",
    help: "Wave hello to someone.",
    gifCategory: "wave",
    render: (actor, target) => `${actor} waves hello to ${target}!`,
  },
  poke: {
    description: "Playfully poke a member.",
    title: "👉 Poke!",
    help: "Playfully poke someone to get their attention.",
    gifCategory: "poke",
    render: (actor, target) => `${actor} pokes ${target}. Poke!`,
  },
  bonk: {
    description: "Give a member a harmless cartoon bonk.",
    title: "🔨 Bonk!",
    help: "Give someone a harmless cartoon bonk.",
    gifCategory: "bonk",
    render: (actor, target) => `${actor} gives ${target} a harmless cartoon bonk!`,
  },
  boop: {
    description: "Give a member a nose boop.",
    title: "👉 Boop!",
    help: "Give someone a friendly nose boop.",
    gifCategory: "pat",
    render: (actor, target) => `${actor} boops ${target}'s nose! Boop!`,
  },
  dance: {
    description: "Do a little dance for a member.",
    title: "💃 Dance!",
    help: "Do a little dance for someone.",
    gifCategory: "dance",
    render: (actor, target) => `${actor} does a little dance for ${target}!`,
  },
  smile: {
    description: "Send a friendly smile to a member.",
    title: "😊 Smile!",
    help: "Share a friendly smile with someone.",
    gifCategory: "smile",
    render: (actor, target) => `${actor} gives ${target} a big friendly smile!`,
  },
  cheer: {
    description: "Cheer a member on.",
    title: "📣 Cheer!",
    help: "Cheer someone on and brighten their day.",
    gifCategory: "happy",
    render: (actor, target) => `${actor} cheers ${target} on! You’ve got this!`,
  },
  handhold: {
    description: "Hold hands with a member.",
    title: "🤝 Hand-hold!",
    help: "Hold hands with someone.",
    gifCategory: "handhold",
    render: (actor, target) => `${actor} holds hands with ${target}.`,
  },
  punch: {
    description: "Throw a harmless cartoon punch at a member.",
    title: "🥊 Cartoon punch!",
    help: "Throw someone a harmless, cartoon-style punch.",
    gifCategory: "punch",
    render: (actor, target) => `${actor} throws a harmless cartoon punch at ${target} — just a game!`,
  },
  blush: {
    description: "Send a blushing anime reaction to a member.",
    title: "😊 Blush!",
    help: "Share a blushing anime reaction with someone.",
    gifCategory: "blush",
    render: (actor, target) => `${actor} blushes at ${target}!`,
  },
  cry: {
    description: "Share a dramatic anime cry with a member.",
    title: "😭 Cry!",
    help: "Share an over-the-top anime cry with someone.",
    gifCategory: "cry",
    render: (actor, target) => `${actor} and ${target} share a dramatic anime cry.`,
  },
  feed: {
    description: "Offer a member a snack.",
    title: "🍡 Snack time!",
    help: "Offer someone a tasty snack.",
    gifCategory: "feed",
    render: (actor, target) => `${actor} offers ${target} a tasty snack!`,
  },
  facepalm: {
    description: "React to a member's silly moment.",
    title: "🤦 Facepalm!",
    help: "Share a playful facepalm reaction.",
    gifCategory: "facepalm",
    render: (actor, target) => `${actor} facepalms at ${target}'s antics.`,
  },
  cartoonkick: {
    description: "Give a member a harmless cartoon kick.",
    title: "🦵 Cartoon kick!",
    help: "Give someone a harmless, cartoon-style kick.",
    gifCategory: "kick",
    render: (actor, target) => `${actor} gives ${target} a harmless cartoon kick — just for fun!`,
  },
  laugh: {
    description: "Laugh along with a member.",
    title: "😂 Laugh!",
    help: "Share a laugh with someone.",
    gifCategory: "laugh",
    render: (actor, target) => `${actor} laughs along with ${target}!`,
  },
  nom: {
    description: "Share a playful snack reaction with a member.",
    title: "😋 Nom!",
    help: "Share a silly anime snack reaction.",
    gifCategory: "nom",
    render: (actor, target) => `${actor} shares a snack break with ${target}. Nom nom!`,
  },
  pout: {
    description: "Send a playful pout to a member.",
    title: "😗 Pout!",
    help: "Send someone a cute, playful pout.",
    gifCategory: "pout",
    render: (actor, target) => `${actor} gives ${target} a playful pout!`,
  },
  shrug: {
    description: "Share a shrug reaction with a member.",
    title: "🤷 Shrug!",
    help: "Share a shrug reaction with someone.",
    gifCategory: "shrug",
    render: (actor, target) => `${actor} shrugs with ${target}.`,
  },
  smug: {
    description: "Give a member a smug anime look.",
    title: "😏 Smug!",
    help: "Send someone a smug anime reaction.",
    gifCategory: "smug",
    render: (actor, target) => `${actor} gives ${target} a smug look.`,
  },
  stare: {
    description: "Give a member a dramatic anime stare.",
    title: "👀 Stare!",
    help: "Send someone a dramatic stare.",
    gifCategory: "stare",
    render: (actor, target) => `${actor} stares dramatically at ${target}.`,
  },
  think: {
    description: "Think through something with a member.",
    title: "🤔 Thinking...",
    help: "Share a thoughtful anime reaction.",
    gifCategory: "think",
    render: (actor, target) => `${actor} thinks this one over with ${target}.`,
  },
  tickle: {
    description: "Give a member a playful tickle.",
    title: "😆 Tickle!",
    help: "Give someone a playful tickle.",
    gifCategory: "tickle",
    render: (actor, target) => `${actor} gives ${target} a playful tickle!`,
  },
  wink: {
    description: "Send a friendly wink to a member.",
    title: "😉 Wink!",
    help: "Send someone a friendly wink.",
    gifCategory: "wink",
    render: (actor, target) => `${actor} gives ${target} a friendly wink!`,
  },
  yeet: {
    description: "Yeet a member in a silly anime-style scene.",
    title: "🚀 Yeet!",
    help: "Send someone flying in a silly, cartoon-style scene.",
    gifCategory: "yeet",
    render: (actor, target) => `${actor} yeets ${target} into a silly anime scene!`,
  },
  clap: {
    description: "Give a member a round of applause.",
    title: "👏 Applause!",
    help: "Give someone a round of applause.",
    gifCategory: "clap",
    render: (actor, target) => `${actor} gives ${target} a big round of applause!`,
  },
  aura: {
    description: "Check a member's daily aura score.",
    title: "✨ Aura check",
    help: "See someone's daily aura points. The score changes each day.",
    gifCategory: "smug",
    render: (_actor, target, targetId) => {
      const score = dailyScore("aura", targetId, -1000, 1000);
      const points = `${score >= 0 ? "+" : ""}${score.toLocaleString()}`;
      const verdict =
        score >= 750
          ? "Unstoppable main-character energy!"
          : score >= 0
            ? "Aura is looking good."
            : "A little aura debt—comeback loading!";
      return `**${target}** has **${points} aura** today. ${verdict}`;
    },
  },
  rizz: {
    description: "Get a member's daily rizz score.",
    title: "😎 Rizz check",
    help: "Get someone's daily charm score, out of 100.",
    gifCategory: "wink",
    render: (_actor, target, targetId) => {
      const score = dailyScore("rizz", targetId, 0, 100);
      const verdict =
        score >= 85
          ? "Certified smooth."
          : score >= 60
            ? "The charm is working."
            : score >= 30
              ? "Rizz is loading..."
              : "Quiet confidence still counts.";
      return `**${target}** has **${score}/100 rizz** today. ${verdict}`;
    },
  },
  vibecheck: {
    description: "Run a playful daily vibe check on a member.",
    title: "🌈 Vibe check",
    help: "Check someone's daily vibe score, out of 100.",
    gifCategory: "smile",
    render: (_actor, target, targetId) => {
      const score = dailyScore("vibe", targetId, 0, 100);
      const verdict =
        score >= 80
          ? "Excellent vibes."
          : score >= 55
            ? "Good energy all around."
            : score >= 30
              ? "A calm, low-key vibe."
              : "Recharge mode—be kind to yourself.";
      return `**${target}** scores **${score}/100** on today's vibe check. ${verdict}`;
    },
  },
  rate: {
    description: "Give a member a playful daily rating.",
    title: "⭐ Daily rating",
    help: "Give someone a friendly, for-fun rating out of 10.",
    gifCategory: "happy",
    render: (_actor, target, targetId) => {
      const score = dailyScore("rate", targetId, 0, 100);
      return `Today's totally-for-fun rating for **${target}**: **${(score / 10).toFixed(1)}/10** ⭐`;
    },
  },
  compliment: {
    description: "Send a member a friendly compliment.",
    title: "💛 A little appreciation",
    help: "Send someone a friendly compliment.",
    gifCategory: "happy",
    render: (_actor, target, targetId) => {
      const compliments = [
        "you make this server a better place.",
        "your energy is always appreciated.",
        "you have a knack for making people smile.",
        "you are more awesome than you realize.",
        "your kindness does not go unnoticed.",
        "you bring great vibes wherever you go.",
        "you are a genuinely fun person to have around.",
        "you deserve a little appreciation today.",
      ];
      const index = dailyScore("compliment", targetId, 0, compliments.length - 1);
      return `**${target}**, ${compliments[index]}`;
    },
  },
  roast: {
    description: "Give a member a gentle, playful roast.",
    title: "🔥 Friendly roast",
    help: "Give someone a light, non-personal roast. Just jokes, all love.",
    gifCategory: "facepalm",
    render: (_actor, target, targetId) => {
      const roasts = [
        "has the confidence of a Wi-Fi router with one bar.",
        "could lose a staring contest to a loading screen.",
        "has main-character energy, but the tutorial is still loading.",
        "is one browser tab away from forgetting the original plan.",
        "could turn a quick question into a full side quest.",
        "brings so much chaos even the group chat needs a map.",
        "has the timing of a software update at 1% battery.",
        "could make a two-option poll feel like a final exam.",
      ];
      const index = dailyScore("roast", targetId, 0, roasts.length - 1);
      return `A friendly roast for **${target}**: ${roasts[index]} All jokes, all love.`;
    },
  },
} satisfies Record<string, SocialAction>;

export type SocialActionName = keyof typeof SOCIAL_ACTIONS;
export const SOCIAL_ACTION_NAMES = Object.keys(SOCIAL_ACTIONS) as SocialActionName[];

function safeDisplayName(name: string): string {
  return name.replace(/@/g, "@\u200b");
}

interface NekoGifResult {
  anime_name?: unknown;
  url?: unknown;
}

interface NekoGifResponse {
  results?: NekoGifResult[];
}

const GIFS_PER_REQUEST = 20;
const RECENT_GIF_HISTORY = 100;
const recentGifUrlsByCategory = new Map<string, Set<string>>();

async function fetchAnimeGif(category: string): Promise<{ url: string; animeName?: string } | null> {
  try {
    const endpoint = new URL(`https://nekos.best/api/v2/${category}`);
    endpoint.searchParams.set("amount", String(GIFS_PER_REQUEST));
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mainz (https://github.com/Muzammil786k/Mainz)",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Anime GIF service returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as NekoGifResponse;
    const candidates = (data.results ?? []).filter(
      (result): result is NekoGifResult & { url: string } =>
        typeof result.url === "string" && result.url.length > 0,
    );
    if (candidates.length === 0) {
      throw new Error("Anime GIF service returned no GIF URL");
    }

    const recent = recentGifUrlsByCategory.get(category) ?? new Set<string>();
    const freshCandidates = candidates.filter((result) => !recent.has(result.url));
    const pool = freshCandidates.length > 0 ? freshCandidates : candidates;
    const result = pool[Math.floor(Math.random() * pool.length)];
    if (!result) {
      throw new Error("Anime GIF service returned no selectable GIF");
    }

    const gifUrl = new URL(result.url);
    if (gifUrl.protocol !== "https:" || gifUrl.hostname !== "nekos.best") {
      throw new Error("Anime GIF service returned an unexpected URL");
    }

    recent.add(gifUrl.href);
    while (recent.size > RECENT_GIF_HISTORY) {
      const oldestUrl = recent.values().next().value;
      if (!oldestUrl) break;
      recent.delete(oldestUrl);
    }
    recentGifUrlsByCategory.set(category, recent);

    return {
      url: gifUrl.href,
      animeName: typeof result.anime_name === "string" ? result.anime_name : undefined,
    };
  } catch (error) {
    logger.warn({ err: error, category }, "Could not fetch anime GIF");
    return null;
  }
}

export async function handleSocialAction(message: Message, actionName: SocialActionName): Promise<void> {
  if (!message.guild) return;

  const targetId =
    message.mentions.users.first()?.id ??
    message.content.trim().split(/\s+/)[1]?.match(/^\d{17,20}$/)?.[0];

  if (!targetId) {
    await message.reply(`❌ Mention a server member. Usage: \`!${actionName} @user\``);
    return;
  }

  const target =
    message.guild.members.cache.get(targetId) ??
    (await message.guild.members.fetch(targetId).catch(() => null));

  if (!target) {
    await message.reply("❌ I couldn’t find that member in this server.");
    return;
  }

  const action = SOCIAL_ACTIONS[actionName];
  const gif = await fetchAnimeGif(action.gifCategory);
  const actorName = safeDisplayName(message.member?.displayName ?? message.author.username);
  const targetName = safeDisplayName(target.displayName);
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription(
      `${action.render(actorName, targetName, target.id)}${gif ? "" : "\n\n🎞️ Anime GIF is temporarily unavailable."}`,
    )
    .setFooter({ text: "Just for fun — keep it friendly." });

  if (gif) embed.setImage(gif.url);

  await message.reply({
    embeds: [embed],
    allowedMentions: { parse: [], repliedUser: false },
  });
}

export async function handleShip(message: Message): Promise<void> {
  if (!message.guild) return;

  const users = [...message.mentions.users.values()];
  if (users.length !== 2) {
    await message.reply({
      content: "❌ Mention exactly two different members. Usage: `!ship @user1 @user2`",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  const [firstUser, secondUser] = users;
  if (!firstUser || !secondUser || firstUser.id === secondUser.id) {
    await message.reply({
      content: "❌ Please choose two different members for the ship check.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  const [firstMember, secondMember] = await Promise.all([
    message.guild.members.cache.get(firstUser.id) ??
      message.guild.members.fetch(firstUser.id).catch(() => null),
    message.guild.members.cache.get(secondUser.id) ??
      message.guild.members.fetch(secondUser.id).catch(() => null),
  ]);
  if (!firstMember || !secondMember) {
    await message.reply({
      content: "❌ I couldn’t find both members in this server.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  const pairKey = [firstUser.id, secondUser.id].sort().join(":");
  const score = seededScore(`ship:${pairKey}`, 0, 100);
  const verdict =
    score >= 90
      ? "Cosmic-level duo energy!"
      : score >= 75
        ? "An elite duo with great chemistry."
        : score >= 50
          ? "Good vibes—this could be a fun duo."
          : score >= 25
            ? "A chaotic duo, but an iconic one."
            : "Opposites attract; the memes are guaranteed.";

  const embed = new EmbedBuilder()
    .setColor(0xff72a6)
    .setTitle("Ship check")
    .setDescription(
      `**${safeDisplayName(firstMember.displayName)} × ${safeDisplayName(secondMember.displayName)}**\n\n**${score}%**\n${verdict}`,
    )
    .setFooter({ text: "Just for fun — not a real compatibility reading." });

  let files: AttachmentBuilder[] = [];
  try {
    const image = await renderShipImage(
      firstUser.displayAvatarURL({ extension: "png", size: 128 }),
      secondUser.displayAvatarURL({ extension: "png", size: 128 }),
      score,
    );
    files = [new AttachmentBuilder(image, { name: "ship.png" })];
    embed.setImage("attachment://ship.png");
  } catch (err) {
    logger.error({ err }, "Failed to render ship image; sending text-only embed");
  }

  await message.reply({
    embeds: [embed],
    files,
    allowedMentions: { parse: [], repliedUser: false },
  });
}
