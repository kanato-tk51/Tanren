import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { concepts } from "./concepts";
import { questions, type RubricCheck } from "./questions";
import { sessions } from "./sessions";
import { users } from "./users";

/** tsvector 型は drizzle に組み込みがないので customType で定義 */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export type RubricCheckResult = {
  id: string;
  passed: boolean;
  comment?: string;
};

export type MisconceptionTag = {
  conceptId: string;
  description: string;
};

export type RebuttalRecord = {
  /** 反論メッセージ (ユーザーが正解だと主張する根拠) */
  message: string;
  /** 元の採点 */
  original: {
    correct: boolean | null;
    score: number | null;
    feedback: string | null;
  };
  /** 再採点後の判定が変わったか (false なら「反論されたが変わらなかった」) */
  overturned: boolean;
  /** 再採点で使ったプロンプト版 */
  promptVersion: string;
  /** 反論時刻 (ISO 8601) */
  at: string;
};

export const attempts = pgTable(
  "attempts",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id),
    userAnswer: text("user_answer"),
    correct: boolean("correct"),
    /** 0.0 - 1.0 */
    score: real("score"),
    /** 自己評価 1-5 */
    selfRating: smallint("self_rating"),
    elapsedMs: integer("elapsed_ms"),
    feedback: text("feedback"),
    rubricChecks: jsonb("rubric_checks").$type<RubricCheckResult[]>(),
    misconceptionTags: jsonb("misconception_tags").$type<MisconceptionTag[]>(),
    rebuttal: jsonb("rebuttal").$type<RebuttalRecord>(),
    reasonGiven: text("reason_given"),
    copiedForExternal: integer("copied_for_external").notNull().default(0),
    /** 採点に使ったプロンプトの版 (CLAUDE.md §4.5)。mcq のようにプロンプト不使用の採点は null */
    promptVersion: text("prompt_version"),
    gradedBy: text("graded_by"),
    /**
     * 全文検索用 tsvector (ADR-0003 / §6.2.2)。
     * user_answer / reason_given / feedback の連結を 'simple' analyzer で index 化する。
     * 日本語は語境界が曖昧なため pg_trgm による trigram index (idx_attempts_trgm) を併用。
     */
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(user_answer, '') || ' ' || coalesce(reason_given, '') || ' ' || coalesce(feedback, ''))`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_attempts_user_concept").on(table.userId, table.conceptId),
    index("idx_attempts_user_created").on(table.userId, table.createdAt.desc()),
    index("idx_attempts_search").using("gin", table.searchTsv),
    index("idx_attempts_trgm").using("gin", sql`${table.userAnswer} gin_trgm_ops`),
    // 同一 session × question に対する attempt は 1 件のみ (二重 submit の防御)
    uniqueIndex("uq_attempts_session_question").on(table.sessionId, table.questionId),
  ],
);

export type Attempt = typeof attempts.$inferSelect;
export type NewAttempt = typeof attempts.$inferInsert;

/** rubric と rubric_checks を上位層で使いまわせるよう re-export */
export type { RubricCheck };
