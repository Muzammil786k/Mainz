import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const botLevelRolesTable = pgTable(
  "bot_level_roles",
  {
    guildId: text("guild_id").notNull(),
    level: integer("level").notNull(),
    roleId: text("role_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.level] })],
);
