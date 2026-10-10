import { boolean, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const botExperiencePreferencesTable = pgTable(
  "bot_experience_preferences",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    serverNotifications: boolean("server_notifications").notNull().default(true),
    dmNotifications: boolean("dm_notifications").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);
