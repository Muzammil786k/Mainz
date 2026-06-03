import {
  Client,
  GatewayIntentBits,
  Partials,
  type MessageReaction,
  type User,
} from "discord.js";
import { handleMessage } from "./commands";
import { giveaways, buildGiveawayEmbed } from "./giveaway";
import { logger } from "../lib/logger";

export function createBot(): Client {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.error("DISCORD_BOT_TOKEN is not set. Bot will not start.");
    return new Client({ intents: [] });
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });

  client.once("ready", () => {
    logger.info({ tag: client.user?.tag }, "Discord bot is ready");
    client.user?.setActivity("🎉 Giveaways | !ghelp");
  });

  client.on("messageCreate", async (message) => {
    try {
      await handleMessage(client, message);
    } catch (err) {
      logger.error({ err }, "Error handling message");
    }
  });

  client.on("messageReactionAdd", async (reaction: MessageReaction, user: User) => {
    try {
      if (user.bot) return;
      if (reaction.emoji.name !== "🎉") return;

      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();

      const giveaway = giveaways.get(reaction.message.id);
      if (!giveaway || giveaway.ended) return;

      giveaway.participants.add(user.id);

      await reaction.message.edit({
        embeds: [buildGiveawayEmbed(giveaway)],
      });
    } catch (err) {
      logger.error({ err }, "Error on reactionAdd");
    }
  });

  client.on("messageReactionRemove", async (reaction: MessageReaction, user: User) => {
    try {
      if (user.bot) return;
      if (reaction.emoji.name !== "🎉") return;

      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();

      const giveaway = giveaways.get(reaction.message.id);
      if (!giveaway || giveaway.ended) return;

      giveaway.participants.delete(user.id);

      await reaction.message.edit({
        embeds: [buildGiveawayEmbed(giveaway)],
      });
    } catch (err) {
      logger.error({ err }, "Error on reactionRemove");
    }
  });

  client.login(token).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
  });

  return client;
}
