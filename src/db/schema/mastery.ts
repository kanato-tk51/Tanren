import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { concepts } from "./concepts";
import { users } from "./users";

/** FSRS 状態。PK は (user_id, concept_id) の複合 */
export const mastery = pgTable(
  "mastery",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id),
    stability: real("stability"),
    difficulty: real("difficulty"),
    lastReview: timestamp("last_review", { withTimezone: true }),
    nextReview: timestamp("next_review", { withTimezone: true }),
    reviewCount: integer("review_count").notNull().default(0),
    lapseCount: integer("lapse_count").notNull().default(0),
    mastered: boolean("mastered").notNull().default(false),
    masteryPct: real("mastery_pct").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.conceptId] }),
    index("idx_mastery_next_review").on(table.userId, table.nextReview),
  ],
);

export type Mastery = typeof mastery.$inferSelect;
export type NewMastery = typeof mastery.$inferInsert;
