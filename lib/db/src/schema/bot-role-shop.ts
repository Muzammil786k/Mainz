import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const botRoleShopTable = pgTable(
  "bot_role_shop",
  {
    guildId: text("guild_id").notNull(),
    roleId: text("role_id").notNull(),
    price: integer("price").notNull(),
    configuredBy: text("configured_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.roleId] })],
);