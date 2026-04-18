import { sql } from "drizzle-orm";
import { date, integer, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

import type { DomainId } from "./_constants";
import { users } from "./users";

export const dailyStats = pgTable(
  "daily_stats",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    attemptsCount: integer("attempts_count").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    conceptsTouched: integer("concepts_touched").notNull().default(0),
    studyTimeSec: integer("study_time_sec").notNull().default(0),
    domainsTouched: jsonb("domains_touched")
      .$type<DomainId[]>()
      .default(sql`'[]'::jsonb`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.date] })],
);

export type DailyStat = typeof dailyStats.$inferSelect;
export type NewDailyStat = typeof dailyStats.$inferInsert;
