import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const botChannelAutomationsTable = pgTable(
  "bot_channel_automations",
  {
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    autoReactEmoji: text("auto_react_emoji"),
    stickyContent: text("sticky_content"),
    stickyMessageId: text("sticky_message_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.channelId] }),
  ],
);

export const botGuildMessagesTable = pgTable("bot_guild_messages", {
  guildId: text("guild_id").primaryKey(),
  welcomeChannelId: text("welcome_channel_id"),
  welcomeTemplate: text("welcome_template"),
  goodbyeChannelId: text("goodbye_channel_id"),
  goodbyeTemplate: text("goodbye_template"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
