import { EmbedBuilder, type Message } from "discord.js";

interface SocialAction {
  description: string;
  title: string;
  help: string;
  render: (actor: string, target: string) => string;
}

export const SOCIAL_ACTIONS = {
  hug: {
    description: "Give a member a warm hug.",
    title: "🫂 Hug!",
    help: "Send someone a warm hug.",
    render: (actor, target) => `${actor} gives ${target} a big, warm hug!`,
  },
  kiss: {
    description: "Send a friendly kiss to a member.",
    title: "😘 Friendly kiss!",
    help: "Send someone a friendly, non-romantic kiss.",
    render: (actor, target) => `${actor} sends ${target} a friendly kiss!`,
  },
  bite: {
    description: "Playfully nibble a member.",
    title: "😬 Playful bite!",
    help: "Give someone a playful cartoon nibble.",
    render: (actor, target) => `${actor} gives ${target} a silly cartoon nibble!`,
  },
  kill: {
    description: "Pretend to defeat a member in a silly game.",
    title: "🎮 Game over!",
    help: "Pretend to defeat someone in a harmless game-style showdown.",
    render: (actor, target) => `${actor} defeats ${target} in a silly game-style showdown. Respawn in 3… 2… 1!`,
  },
  slap: {
    description: "Give a member a light cartoon-style slap.",
    title: "🖐️ Cartoon slap!",
    help: "Give someone a harmless, cartoon-style slap.",
    render: (actor, target) => `${actor} gives ${target} a harmless cartoon-style slap!`,
  },
  pat: {
    description: "Give a member a gentle head pat.",
    title: "🐾 Head pat!",
    help: "Give someone a gentle head pat.",
    render: (actor, target) => `${actor} gives ${target} a gentle head pat.`,
  },
  cuddle: {
    description: "Cuddle up with a member.",
    title: "🧸 Cuddle!",
    help: "Share a cozy cuddle with someone.",
    render: (actor, target) => `${actor} cuddles up with ${target}. Cozy mode: activated!`,
  },
  highfive: {
    description: "Give a member a high-five.",
    title: "🙌 High-five!",
    help: "Give someone a high-five.",
    render: (actor, target) => `${actor} gives ${target} a high-five!`,
  },
  wave: {
    description: "Wave hello to a member.",
    title: "👋 Hello!",
    help: "Wave hello to someone.",
    render: (actor, target) => `${actor} waves hello to ${target}!`,
  },
  poke: {
    description: "Playfully poke a member.",
    title: "👉 Poke!",
    help: "Playfully poke someone to get their attention.",
    render: (actor, target) => `${actor} pokes ${target}. Poke!`,
  },
  bonk: {
    description: "Give a member a harmless cartoon bonk.",
    title: "🔨 Bonk!",
    help: "Give someone a harmless cartoon bonk.",
    render: (actor, target) => `${actor} gives ${target} a harmless cartoon bonk!`,
  },
  boop: {
    description: "Give a member a nose boop.",
    title: "👉 Boop!",
    help: "Give someone a friendly nose boop.",
    render: (actor, target) => `${actor} boops ${target}'s nose! Boop!`,
  },
  dance: {
    description: "Do a little dance for a member.",
    title: "💃 Dance!",
    help: "Do a little dance for someone.",
    render: (actor, target) => `${actor} does a little dance for ${target}!`,
  },
  smile: {
    description: "Send a friendly smile to a member.",
    title: "😊 Smile!",
    help: "Share a friendly smile with someone.",
    render: (actor, target) => `${actor} gives ${target} a big friendly smile!`,
  },
  cheer: {
    description: "Cheer a member on.",
    title: "📣 Cheer!",
    help: "Cheer someone on and brighten their day.",
    render: (actor, target) => `${actor} cheers ${target} on! You’ve got this!`,
  },
  handhold: {
    description: "Hold hands with a member.",
    title: "🤝 Hand-hold!",
    help: "Hold hands with someone.",
    render: (actor, target) => `${actor} holds hands with ${target}.`,
  },
  punch: {
    description: "Throw a harmless cartoon punch at a member.",
    title: "🥊 Cartoon punch!",
    help: "Throw someone a harmless, cartoon-style punch.",
    render: (actor, target) => `${actor} throws a harmless cartoon punch at ${target} — just a game!`,
  },
} satisfies Record<string, SocialAction>;

export type SocialActionName = keyof typeof SOCIAL_ACTIONS;
export const SOCIAL_ACTION_NAMES = Object.keys(SOCIAL_ACTIONS) as SocialActionName[];

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
  await message.reply({
    content: `<@${target.id}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle(action.title)
        .setDescription(action.render(`<@${message.author.id}>`, `<@${target.id}>`))
        .setFooter({ text: "Just for fun — keep it friendly." })
        .setTimestamp(),
    ],
    allowedMentions: { users: [target.id], repliedUser: false },
  });
}
