import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const botExperienceSettingsTable = pgTable("bot_experience_settings", {
  guildId: text("guild_id").primaryKey(),
  levelUpChannelId: text("level_up_channel_id"),
  economyChannelId: text("economy_channel_id"),
  embedTitle: text("embed_title"),
  embedDescription: text("embed_description"),
  embedColor: text("embed_color"),
  allowedChatChannelIds: text("allowed_chat_channel_ids").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
