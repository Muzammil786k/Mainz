import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const botTicketSettingsTable = pgTable("bot_ticket_settings", {
  guildId: text("guild_id").primaryKey(),
  categoryId: text("category_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const botTicketsTable = pgTable("bot_tickets", {
  channelId: text("channel_id").primaryKey(),
  guildId: text("guild_id").notNull(),
  ownerId: text("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});