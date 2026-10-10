import { bigint, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const botExperienceTable = pgTable(
  "bot_experience",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    totalXp: integer("total_xp").notNull().default(0),
    level: integer("level").notNull().default(1),
    lastChatXpAt: bigint("last_chat_xp_at", { mode: "number" }).notNull().default(0),
    lastVoiceXpAt: bigint("last_voice_xp_at", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);
