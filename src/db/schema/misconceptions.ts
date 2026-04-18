import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { concepts } from "./concepts";
import { users } from "./users";

export const misconceptions = pgTable("misconceptions", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()::text`),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  conceptId: text("concept_id")
    .notNull()
    .references(() => concepts.id),
  description: text("description").notNull(),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  count: integer("count").notNull().default(1),
  resolved: boolean("resolved").notNull().default(false),
});

export type Misconception = typeof misconceptions.$inferSelect;
export type NewMisconception = typeof misconceptions.$inferInsert;
