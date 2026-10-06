import { EmbedBuilder, type Message } from "discord.js";
import { logger } from "../lib/logger";

interface SocialAction {
  description: string;
  title: string;
  help: string;
  gifCategory: string;
  render: (actor: string, target: string) => string;
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

async function fetchAnimeGif(category: string): Promise<{ url: string; animeName?: string } | null> {
  try {
    const response = await fetch(`https://nekos.best/api/v2/${category}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "HangoutSaiBot (https://github.com/Muzammil786k/Mainz)",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Anime GIF service returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as NekoGifResponse;
    const result = data.results?.[0];
    if (typeof result?.url !== "string") {
      throw new Error("Anime GIF service returned no GIF URL");
    }

    const gifUrl = new URL(result.url);
    if (gifUrl.protocol !== "https:" || gifUrl.hostname !== "nekos.best") {
      throw new Error("Anime GIF service returned an unexpected URL");
    }

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
    .setTitle(action.title)
    .setDescription(
      `${action.render(actorName, targetName)}${gif ? "" : "\n\n🎞️ Anime GIF is temporarily unavailable."}`,
    )
    .setFooter({ text: "Just for fun — keep it friendly." });

  if (gif) embed.setImage(gif.url);

  await message.reply({
    embeds: [embed],
    allowedMentions: { parse: [], repliedUser: false },
  });
}
