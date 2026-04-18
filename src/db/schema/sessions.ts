import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { SessionKind } from "./_constants";
import { sessionTemplates } from "./session-templates";
import { users } from "./users";

/** 学習セッション (認証 sessions_auth とは別物) */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<SessionKind>().notNull(),
    /** Custom Session のときだけ CustomSessionSpec が入る */
    spec: jsonb("spec"),
    templateId: text("template_id").references(() => sessionTemplates.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    questionCount: integer("question_count").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
  },
  (table) => [index("idx_sessions_user_started").on(table.userId, table.startedAt.desc())],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
