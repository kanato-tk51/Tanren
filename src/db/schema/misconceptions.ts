import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { concepts } from "./concepts";
import { users } from "./users";

export const misconceptions = pgTable(
  "misconceptions",
  {
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
  },
  (table) => [
    // issue #19: ON CONFLICT DO UPDATE で原子的に count+1 するため、
    // (user_id, concept_id, description) で一意制約を張る。description は
    // normalize 済み (trim + lower) で書き込まれる前提。
    uniqueIndex("uq_misconceptions_user_concept_desc").on(
      table.userId,
      table.conceptId,
      table.description,
    ),
  ],
);

export type Misconception = typeof misconceptions.$inferSelect;
export type NewMisconception = typeof misconceptions.$inferInsert;
