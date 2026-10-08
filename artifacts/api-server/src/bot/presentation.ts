import {
  EmbedBuilder,
  type APIEmbed,
  type ClientUser,
  type Message,
  type MessageCreateOptions,
} from "discord.js";

const BRAND = "HangoutSaiBot";
const BRAND_COLOR = 0x5865f2;
const SUCCESS_COLOR = 0x57f287;
const WARNING_COLOR = 0xfee75c;
const ERROR_COLOR = 0xed4245;

function responseColor(text: string): number {
  const trimmed = text.trimStart();
  if (/^(?:❌|⛔|🚫)/u.test(trimmed)) return ERROR_COLOR;
  if (/^(?:⚠️|⚠|🟡)/u.test(trimmed)) return WARNING_COLOR;
  if (/^(?:✅|🎉|🟢)/u.test(trimmed)) return SUCCESS_COLOR;
  return BRAND_COLOR;
}

function asApiEmbed(value: unknown): APIEmbed {
  if (value && typeof value === "object" && "toJSON" in value) {
    const toJSON = (value as { toJSON?: () => APIEmbed }).toJSON;
    if (typeof toJSON === "function") return toJSON.call(value);
  }
  return value as APIEmbed;
}

function brandEmbed(value: unknown, user: ClientUser | null, fallbackText: string): EmbedBuilder {
  const data = asApiEmbed(value);
  const embed = EmbedBuilder.from(data).setColor(
    responseColor(`${fallbackText}\n${data.description ?? ""}`),
  );

  if (!data.author) {
    const iconURL = user?.displayAvatarURL({ size: 64 });
    embed.setAuthor(iconURL ? { name: BRAND, iconURL } : { name: BRAND });
  }

  const existingFooter = data.footer?.text?.trim();
  const footerText = existingFooter
    ? existingFooter.includes(BRAND)
      ? existingFooter
      : `${existingFooter} · ${BRAND}`
    : `${BRAND} • /help`;
  const footerIcon = user?.displayAvatarURL({ size: 64 }) ?? data.footer?.icon_url;
  embed.setFooter(footerIcon ? { text: footerText, iconURL: footerIcon } : { text: footerText });
  return embed;
}

function styleReplyPayload(
  payload: unknown,
  user: ClientUser | null,
  clearExistingContent = false,
): unknown {
  if (typeof payload !== "string" && (!payload || typeof payload !== "object")) {
    return payload;
  }

  const options: Record<string, unknown> =
    typeof payload === "string"
      ? { content: payload }
      : { ...(payload as Record<string, unknown>) };
  const content = typeof options.content === "string" ? options.content : "";
  const existingEmbeds = Array.isArray(options.embeds) ? options.embeds : [];

  if (existingEmbeds.length > 0) {
    options.embeds = existingEmbeds.map((embed) => brandEmbed(embed, user, content));
    return options;
  }

  if (content.trim()) {
    const iconURL = user?.displayAvatarURL({ size: 64 });
    const embed = new EmbedBuilder()
      .setColor(responseColor(content))
      .setDescription(content.slice(0, 4096))
      .setFooter(
        iconURL
          ? { text: `${BRAND} • /help`, iconURL }
          : { text: `${BRAND} • /help` },
      );
    if (iconURL) embed.setAuthor({ name: BRAND, iconURL });
    if (clearExistingContent) {
      options.content = null;
    } else {
      delete options.content;
    }
    options.embeds = [embed];
  }

  return options;
}

/**
 * Applies a shared branded style to command replies without changing how
 * individual command handlers build their payloads.
 */
export function withPremiumReplies(message: Message, user: ClientUser | null): Message {
  const wrap = (target: Message): Message =>
    new Proxy(target, {
      get(original, property) {
        if (property === "reply") {
          return async (payload: unknown) => {
            const reply = original.reply.bind(original) as (value: unknown) => Promise<Message>;
            return wrap(await reply(styleReplyPayload(payload, user)));
          };
        }
        if (property === "edit") {
          return async (payload: unknown) => {
            const edit = original.edit.bind(original) as (value: unknown) => Promise<Message>;
            return wrap(await edit(styleReplyPayload(payload, user, true)));
          };
        }

        const value = Reflect.get(original, property, original);
        return typeof value === "function" ? value.bind(original) : value;
      },
    });

  return wrap(message);
}

export function premiumMessagePayload(
  payload: string | MessageCreateOptions,
  user: ClientUser | null,
): MessageCreateOptions {
  return styleReplyPayload(payload, user) as MessageCreateOptions;
}

export function premiumEmbed(
  description: string,
  options: { title?: string; color?: number; thumbnail?: string } = {},
  user?: ClientUser | null,
): EmbedBuilder {
  const iconURL = user?.displayAvatarURL({ size: 64 });
  const embed = new EmbedBuilder()
    .setColor(options.color ?? responseColor(description))
    .setDescription(description.slice(0, 4096))
    .setFooter(
      iconURL
        ? { text: `${BRAND} • /help`, iconURL }
        : { text: `${BRAND} • /help` },
    )
    .setTimestamp();

  if (options.title) embed.setTitle(options.title);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (iconURL) embed.setAuthor({ name: BRAND, iconURL });
  return embed;
}

export const premiumColors = {
  brand: BRAND_COLOR,
  success: SUCCESS_COLOR,
  warning: WARNING_COLOR,
  error: ERROR_COLOR,
} as const;
