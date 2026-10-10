import { bigint, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const botExperienceBoostsTable = pgTable(
  "bot_experience_boosts",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    source: text("source").notNull(),
    boostPercent: integer("boost_percent").notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId, table.source] })],
);
