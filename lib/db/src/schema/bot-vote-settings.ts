import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const botVoteSettingsTable = pgTable("bot_vote_settings", {
  guildId: text("guild_id").primaryKey(),
  channelId: text("channel_id").notNull(),
  topggUrl: text("topgg_url").notNull(),
  discadiaUrl: text("discadia_url").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
