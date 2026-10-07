import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits,
  StickerFormatType,
  type Message,
  type Sticker,
} from "discord.js";
import sharp from "sharp";
import { logger } from "../lib/logger";

type AssetKind = "emoji" | "sticker";

interface StealableAsset {
  name: string;
  emoji: string;
  display: string;
  emojiUrl: string;
  stickerUrl: string;
  extension: "png" | "gif" | "apng";
  sourceType: "emoji" | "sticker";
  twemojiArtwork: boolean;
}

interface ProcessedImage {
  data: Buffer;
  extension: "png" | "gif";
}

const CUSTOM_EMOJI_PATTERN = /<(a?):([a-zA-Z0-9_]{2,32}):(\d{17,20})>/;
const UNICODE_EMOJI_PATTERN =
  /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*)/u;
const MAX_EMOJI_BYTES = 256 * 1024;
const MAX_STICKER_BYTES = 512 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const STICKER_DIMENSION = 320;
const COMPONENT_TIMEOUT = 60_000;

function emojiFromMessage(content: string): StealableAsset | null {
  const customMatch = CUSTOM_EMOJI_PATTERN.exec(content);
  const unicodeMatch = UNICODE_EMOJI_PATTERN.exec(content);
  if (customMatch && (!unicodeMatch || customMatch.index <= unicodeMatch.index)) {
    const [, animatedFlag, emojiName, emojiId] = customMatch;
    if (!emojiName || !emojiId) return null;

    const extension = animatedFlag === "a" ? "gif" : "png";
    const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${extension}?size=128`;
    const stickerUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${extension}?size=512`;
    return {
      name: emojiName,
      emoji: customMatch[0],
      display: customMatch[0],
      emojiUrl,
      stickerUrl,
      extension,
      sourceType: "emoji",
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
    display: emoji,
    emojiUrl: imageUrl,
    stickerUrl: imageUrl,
    extension: "png",
    sourceType: "emoji",
    twemojiArtwork: true,
  };
}

function stickerFromMessage(sticker: Sticker): StealableAsset | null {
  let extension: StealableAsset["extension"];
  switch (sticker.format) {
    case StickerFormatType.PNG:
      extension = "png";
      break;
    case StickerFormatType.APNG:
      extension = "apng";
      break;
    case StickerFormatType.GIF:
      extension = "gif";
      break;
    default:
      return null;
  }

  return {
    name: sticker.name,
    emoji: "✨",
    display: `sticker \`${safeAssetName(sticker.name, 30)}\``,
    emojiUrl: sticker.url,
    stickerUrl: sticker.url,
    extension,
    sourceType: "sticker",
    twemojiArtwork: false,
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

async function fetchAssetImage(
  source: StealableAsset,
  kind: AssetKind,
): Promise<ProcessedImage> {
  const response = await fetch(kind === "emoji" ? source.emojiUrl : source.stickerUrl, {
    headers: { Accept: "image/png,image/apng,image/gif" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Image service returned HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("The source image is too large to process safely.");
  }

  const sourceImage = Buffer.from(await response.arrayBuffer());
  if (sourceImage.length === 0 || sourceImage.length > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("The source image is too large or empty.");
  }

  if (kind === "emoji" && source.sourceType === "emoji") {
    if (sourceImage.length > MAX_EMOJI_BYTES) {
      throw new Error("The image is too large to add as an emoji.");
    }
    return {
      data: sourceImage,
      extension: source.extension === "gif" ? "gif" : "png",
    };
  }

  const animated = source.extension !== "png";
  const dimension = kind === "emoji" ? 128 : STICKER_DIMENSION;
  const resizedImage = sharp(sourceImage, { animated }).resize({
    width: dimension,
    height: dimension,
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  const extension = animated ? "gif" : "png";
  const image =
    animated
      ? await resizedImage.gif().toBuffer()
      : await resizedImage.png().toBuffer();

  const maxBytes = kind === "emoji" ? MAX_EMOJI_BYTES : MAX_STICKER_BYTES;
  if (image.length === 0 || image.length > maxBytes) {
    throw new Error(
      kind === "emoji"
        ? "The image is too large to add as an emoji."
        : "The resized image is too large or empty for a sticker.",
    );
  }
  return { data: image, extension };
}

async function addEmoji(message: Message, source: StealableAsset): Promise<string> {
  const guild = message.guild!;
  const name = uniqueAssetName(message, source.name, "emoji");
  const image = await fetchAssetImage(source, "emoji");
  const mimeType = image.extension === "gif" ? "image/gif" : "image/png";
  const created = await guild.emojis.create({
    attachment: `data:${mimeType};base64,${image.data.toString("base64")}`,
    name,
    reason: `Requested through !steal by ${message.author.id}`,
  });
  return `✅ Added ${created} as the server emoji **:${created.name}:**.`;
}

async function addSticker(message: Message, source: StealableAsset): Promise<string> {
  const guild = message.guild!;
  const name = uniqueAssetName(message, source.name, "sticker");
  const image = await fetchAssetImage(source, "sticker");
  const stickerTag =
    source.sourceType === "emoji" && !CUSTOM_EMOJI_PATTERN.test(source.emoji)
      ? source.emoji
      : "✨";
  const created = await guild.stickers.create({
    file: { attachment: image.data, name: `${name}.${image.extension}` },
    name,
    tags: stickerTag,
    description: "Added with !steal.",
    reason: `Requested through !steal by ${message.author.id}`,
  });
  return `✅ Added **${created.name}** as a server sticker.`;
}

function withArtworkCredit(text: string, source: StealableAsset): string {
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
      content: "Reply to a message containing an emoji or sticker, then send `!steal`.",
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
  const stickers = [...referencedMessage.stickers.values()];
  const sourceSticker = stickers
    .map(stickerFromMessage)
    .find((asset): asset is StealableAsset => asset !== null);
  const source = sourceSticker ?? emojiFromMessage(searchableContent);
  if (!source) {
    const hasLottieSticker = stickers.some(
      (sticker) => sticker.format === StickerFormatType.Lottie,
    );
    await message.reply({
      content: hasLottieSticker
        ? "❌ I found a Lottie sticker, which can't be converted to an image yet. Reply to a message with a PNG, APNG, or GIF sticker instead."
        : "❌ I couldn't find an emoji or image sticker in that message. Reply to a message containing an emoji or PNG, APNG, or GIF sticker.",
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
    content: `Found ${source.display}. Choose how to add it to this server.`,
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
        content: "Only the person who ran `!steal` can choose how to add this asset.",
        ephemeral: true,
      });
      return;
    }
    if (isAdding) {
      await interaction.reply({ content: "This asset is already being added.", ephemeral: true });
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
          : "Discord rejected the upload. The server may be out of slots, the bot may lack permission, or the image may not meet Discord's sticker requirements.";
      await choiceMessage
        .edit({
          content: `❌ Couldn't add it. ${reason} Emoji files must be at most 256 KiB and stickers at most 512 KiB.`,
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
