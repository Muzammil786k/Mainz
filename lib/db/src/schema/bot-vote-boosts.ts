import { bigint, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const botVoteBoostsTable = pgTable(
  "bot_vote_boosts",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    boostUntil: bigint("boost_until", { mode: "number" }).notNull().default(0),
    lastTopggVoteAt: bigint("last_topgg_vote_at", { mode: "number" }).notNull().default(0),
    lastDiscadiaVoteAt: bigint("last_discadia_vote_at", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);
