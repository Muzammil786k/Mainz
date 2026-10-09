import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const botSocialRoleGateTable = pgTable("bot_social_role_gate", {
  guildId: text("guild_id").primaryKey(),
  requiredRoleId: text("required_role_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});