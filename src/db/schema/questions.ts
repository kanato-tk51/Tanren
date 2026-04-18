import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { DifficultyLevel, QuestionType, ThinkingStyle } from "./_constants";
import { concepts } from "./concepts";

/** tsvector 型は drizzle 組み込みにないので customType で定義 (attempts.ts と同一定義) */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export type RubricCheck = {
  id: string;
  description: string;
  weight?: number;
};

export const questions = pgTable(
  "questions",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id),
    type: text("type").$type<QuestionType>().notNull(),
    thinkingStyle: text("thinking_style").$type<ThinkingStyle>(),
    difficulty: text("difficulty").$type<DifficultyLevel>().notNull(),
    prompt: text("prompt").notNull(),
    answer: text("answer").notNull(),
    rubric: jsonb("rubric").$type<RubricCheck[]>(),
    /** mcq のときだけ埋まる。選択肢テキスト配列 */
    distractors: jsonb("distractors").$type<string[]>(),
    hint: text("hint"),
    explanation: text("explanation"),
    tags: jsonb("tags")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`),
    /** 'gpt-5' / 'gpt-5-mini' など */
    generatedBy: text("generated_by"),
    promptVersion: text("prompt_version"),
    retired: boolean("retired").notNull().default(false),
    retiredReason: text("retired_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastServedAt: timestamp("last_served_at", { withTimezone: true }),
    serveCount: integer("serve_count").notNull().default(0),
    /**
     * 全文検索用 tsvector (issue #30)。prompt + answer を対象に 'simple' 構成で生成。
     * 生成済み STORED カラム + GIN 索引で `@@ plainto_tsquery` が定数時間レベル。
     * 日本語は pg_trgm の GIN 索引 (idx_questions_prompt_trgm) を併用する。
     */
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(prompt, '') || ' ' || coalesce(answer, ''))`,
    ),
  },
  (table) => [
    index("idx_questions_concept_type_style")
      .on(table.conceptId, table.type, table.thinkingStyle, table.difficulty)
      .where(sql`${table.retired} = FALSE`),
    index("idx_questions_search_tsv").using("gin", table.searchTsv),
    index("idx_questions_prompt_trgm").using("gin", sql`${table.prompt} gin_trgm_ops`),
  ],
);

export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
