import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits,
  type Message,
} from "discord.js";
import { logger } from "../lib/logger";

type AssetKind = "emoji" | "sticker";

interface StealableEmoji {
  name: string;
  emoji: string;
  emojiUrl: string;
  stickerUrl: string;
  extension: "png" | "gif";
  twemojiArtwork: boolean;
}

const CUSTOM_EMOJI_PATTERN = /<(a?):([a-zA-Z0-9_]{2,32}):(\d{17,20})>/;
const UNICODE_EMOJI_PATTERN =
  /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*)/u;
const MAX_EMOJI_BYTES = 256 * 1024;
const MAX_STICKER_BYTES = 512 * 1024;
const COMPONENT_TIMEOUT = 60_000;

function emojiFromMessage(content: string): StealableEmoji | null {
  const customMatch = CUSTOM_EMOJI_PATTERN.exec(content);
  const unicodeMatch = UNICODE_EMOJI_PATTERN.exec(content);
  if (customMatch && (!unicodeMatch || customMatch.index <= unicodeMatch.index)) {
    const [, animatedFlag, emojiName, emojiId] = customMatch;
    if (!emojiName || !emojiId) return null;

    const extension = animatedFlag === "a" ? "gif" : "png";
    const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${extension}?size=128`;
    const stickerUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${extension}?size=320`;
    return {
      name: emojiName,
      emoji: customMatch[0],
      emojiUrl,
      stickerUrl,
      extension,
      twemojiArtwork: false,
    };
  }

  const emoji = unicodeMatch?.[0];
  if (!emoji) return null;

  const codepoints = Array.from(emoji)
    .map((character) => character.codePointAt(0))
    .filter((codepoint): codepoint is number => codepoint !== undefined && codepoint !== 0xfe0e && codepoint !== 0xfe0f)
    .map((codepoint) => codepoint.toString(16))
    .join("-");
  if (!codepoints) return null;

  const imageUrl = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${codepoints}.png`;
  return {
    name: `emoji_${codepoints.replace(/-/g, "_")}`,
    emoji,
    emojiUrl: imageUrl,
    stickerUrl: imageUrl,
    extension: "png",
    twemojiArtwork: true,
  };
}

function safeAssetName(name: string, maxLength: number): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
  return cleaned.length >= 2 ? cleaned : "stolen_emoji";
}

function uniqueAssetName(message: Message, baseName: string, kind: AssetKind): string {
  const maxLength = kind === "emoji" ? 32 : 30;
  const base = safeAssetName(baseName, maxLength);
  const existingNames =
    kind === "emoji"
      ? new Set(message.guild!.emojis.cache.map((item) => item.name.toLowerCase()))
      : new Set(message.guild!.stickers.cache.map((item) => item.name.toLowerCase()));

  if (!existingNames.has(base)) return base;

  for (let suffix = 2; suffix < 10_000; suffix++) {
    const suffixText = `_${suffix}`;
    const candidate = `${base.slice(0, maxLength - suffixText.length)}${suffixText}`;
    if (!existingNames.has(candidate)) return candidate;
  }
  return `${base.slice(0, maxLength - 5)}_copy`;
}

async function fetchEmojiImage(source: StealableEmoji, kind: AssetKind): Promise<Buffer> {
  const maxBytes = kind === "emoji" ? MAX_EMOJI_BYTES : MAX_STICKER_BYTES;
  const response = await fetch(kind === "emoji" ? source.emojiUrl : source.stickerUrl, {
    headers: { Accept: "image/png,image/gif" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Emoji image service returned HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`The image is too large to add as a ${kind}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error(`The image is too large or empty for a ${kind}.`);
  }
  return bytes;
}

async function addEmoji(message: Message, source: StealableEmoji): Promise<string> {
  const guild = message.guild!;
  const name = uniqueAssetName(message, source.name, "emoji");
  const image = await fetchEmojiImage(source, "emoji");
  const mimeType = source.extension === "gif" ? "image/gif" : "image/png";
  const created = await guild.emojis.create({
    attachment: `data:${mimeType};base64,${image.toString("base64")}`,
    name,
    reason: `Requested through !steal by ${message.author.id}`,
  });
  return `✅ Added ${created} as the server emoji **:${created.name}:**.`;
}

async function addSticker(message: Message, source: StealableEmoji): Promise<string> {
  const guild = message.guild!;
  const name = uniqueAssetName(message, source.name, "sticker");
  const image = await fetchEmojiImage(source, "sticker");
  const created = await guild.stickers.create({
    file: { attachment: image, name: `${name}.${source.extension}` },
    name,
    tags: source.name.slice(0, 200) || "emoji",
    description: "Added from an emoji with !steal.",
    reason: `Requested through !steal by ${message.author.id}`,
  });
  return `✅ Added **${created.name}** as a server sticker.`;
}

function withArtworkCredit(text: string, source: StealableEmoji): string {
  return source.twemojiArtwork
    ? `${text}\nArtwork: Twemoji (CC BY 4.0) — https://github.com/jdecked/twemoji`
    : text;
}

export async function handleSteal(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const member =
    message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
  if (!member?.permissions.has(PermissionFlagsBits.CreateGuildExpressions)) {
    await message.reply({
      content: "❌ You need **Create Expressions** permission to add emojis or stickers.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  const botMember = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!botMember?.permissions.has(PermissionFlagsBits.CreateGuildExpressions)) {
    await message.reply({
      content: "❌ I need **Create Expressions** permission to add emojis or stickers here.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  if (!message.reference?.messageId) {
    await message.reply({
      content: "Reply to a message containing an emoji, then send `!steal`.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  const referencedMessage = await message.fetchReference().catch(() => null);
  if (!referencedMessage) {
    await message.reply({
      content: "❌ I couldn't read the message you replied to. Check that I can view message history.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  const searchableContent = [
    referencedMessage.content,
    ...referencedMessage.embeds.flatMap((embed) => [
      embed.title ?? "",
      embed.description ?? "",
      ...embed.fields.map((field) => `${field.name} ${field.value}`),
    ]),
  ].join("\n");
  const source = emojiFromMessage(searchableContent);
  if (!source) {
    await message.reply({
      content: "❌ I couldn't find an emoji in that message. Reply to a message containing an emoji.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("steal_add_emoji")
      .setLabel("Add as emoji")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("steal_add_sticker")
      .setLabel("Add as sticker")
      .setStyle(ButtonStyle.Secondary),
  );
  const choiceMessage = await message.reply({
    content: `Found ${source.emoji}. Choose how to add it to this server.`,
    components: [buttons],
    allowedMentions: { parse: [], repliedUser: false },
  });
  const collector = choiceMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: COMPONENT_TIMEOUT,
  });
  let isAdding = false;

  collector.on("collect", async (interaction) => {
    if (interaction.user.id !== message.author.id) {
      await interaction.reply({
        content: "Only the person who ran `!steal` can choose how to add this emoji.",
        ephemeral: true,
      });
      return;
    }
    if (isAdding) {
      await interaction.reply({ content: "This emoji is already being added.", ephemeral: true });
      return;
    }

    isAdding = true;
    await interaction.deferUpdate();

    try {
      const result =
        interaction.customId === "steal_add_emoji"
          ? await addEmoji(message, source)
          : await addSticker(message, source);
      await choiceMessage.edit({
        content: withArtworkCredit(result, source),
        components: [],
      });
    } catch (error) {
      logger.warn({ err: error, guildId: guild.id }, "Could not add a stolen emoji or sticker");
      const reason =
        error instanceof Error && error.message.includes("too large")
          ? error.message
          : "The server may be out of slots or the bot may not have permission.";
      await choiceMessage
        .edit({
          content: `❌ Couldn't add it. ${reason} Emoji files must be under 256 KB and stickers under 512 KB.`,
          components: [],
        })
        .catch(() => {});
    } finally {
      collector.stop("completed");
    }
  });

  collector.on("end", async () => {
    await choiceMessage.edit({ components: [] }).catch(() => {});
  });
}
