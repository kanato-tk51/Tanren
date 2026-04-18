import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { DifficultyLevel, QuestionType, ThinkingStyle } from "./_constants";
import { concepts } from "./concepts";

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
  },
  (table) => [
    index("idx_questions_concept_type_style")
      .on(table.conceptId, table.type, table.thinkingStyle, table.difficulty)
      .where(sql`${table.retired} = FALSE`),
  ],
);

export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
