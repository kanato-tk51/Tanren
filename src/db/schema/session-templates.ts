import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { users } from "./users";

/** Custom Session の spec は JSON 構造を Zod で別途パース (04-custom-sessions.md) */
export const sessionTemplates = pgTable("session_templates", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()::text`),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rawRequest: text("raw_request"),
  spec: jsonb("spec").notNull(),
  useCount: integer("use_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SessionTemplate = typeof sessionTemplates.$inferSelect;
export type NewSessionTemplate = typeof sessionTemplates.$inferInsert;
