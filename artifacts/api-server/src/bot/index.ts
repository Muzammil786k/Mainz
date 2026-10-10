import {
  Client,
  GatewayIntentBits,
  Partials,
  type MessageReaction,
  type User,
} from "discord.js";
import { handleMessage } from "./commands";
import { handleSlashCommand, registerSlashCommands } from "./slash";
import { handleSocialBackButton } from "./social";
import { giveaways, buildGiveawayEmbed } from "./giveaway";
import { handleJtcInteraction, handleVoiceStateUpdate } from "./joinToCreate";
import { handleTicketInteraction } from "./tickets";
import { logger } from "../lib/logger";
import { processUserMessageAutomations, sendMemberMessage } from "./automation";
import { startVoiceXp, trackVoiceXpState } from "./experience";
import { setVoteClient } from "./voting";
import { handleCrateReaction, startCrateScheduler } from "./crates";
import { sendBoostMessage } from "./boost-message";

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
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });
  setVoteClient(client);

  client.once("ready", () => {
    logger.info({ tag: client.user?.tag }, "Discord bot is ready");
    client.user?.setActivity("🎉 Giveaways | !help | /help");
    startVoiceXp(client);
    startCrateScheduler(client);
    void registerSlashCommands(client);
  });

  client.on("guildCreate", (guild) => {
    void registerSlashCommands(client).catch((err) => {
      logger.error({ err, guildId: guild.id }, "Failed to register commands for new guild");
    });
  });

  client.on("messageCreate", async (message) => {
    try {
      await handleMessage(client, message);
    } catch (err) {
      logger.error({ err }, "Error handling message");
    } finally {
      await processUserMessageAutomations(client, message);
    }
  });

  client.on("guildMemberAdd", (member) => {
    void sendMemberMessage(client, member, "welcome").catch((err) => {
      logger.error({ err, guildId: member.guild.id }, "Could not send welcome message");
    });
  });

  client.on("guildMemberRemove", (member) => {
    void sendMemberMessage(client, member, "goodbye").catch((err) => {
      logger.error({ err, guildId: member.guild.id }, "Could not send goodbye message");
    });
  });

  client.on("guildMemberUpdate", (oldMember, newMember) => {
    if (oldMember.premiumSinceTimestamp !== null || newMember.premiumSinceTimestamp === null) return;
    void sendBoostMessage(newMember).catch((err) => {
      logger.error({ err, guildId: newMember.guild.id, userId: newMember.id }, "Could not send server boost message");
    });
  });

  client.on("voiceStateUpdate", (oldState, newState) => {
    trackVoiceXpState(oldState, newState);
    void handleVoiceStateUpdate(client, oldState, newState).catch((err) => {
      logger.error({ err, guildId: newState.guild.id }, "Error handling voice state update");
    });
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith("social:back:")) {
      await handleSocialBackButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("ticket:close:")) {
      await handleTicketInteraction(interaction);
      return;
    }
    if (
      (interaction.isButton() || interaction.isModalSubmit()) &&
      interaction.customId.startsWith("jtc:")
    ) {
      try {
        await handleJtcInteraction(interaction);
      } catch (err) {
        logger.error({ err, customId: interaction.customId }, "Error handling join-to-create interaction");
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    await handleSlashCommand(client, interaction);
  });

  client.on("messageReactionAdd", async (reaction: MessageReaction, user: User) => {
    try {
      if (user.bot) return;
      await handleCrateReaction(reaction, user);
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
