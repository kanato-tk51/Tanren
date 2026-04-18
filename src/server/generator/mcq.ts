import { and, desc, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  concepts,
  questions,
  type Concept,
  type DifficultyLevel,
  type Question,
  type ThinkingStyle,
} from "@/db/schema";
import { getOpenAI } from "@/lib/openai/client";
import { MODEL_MAIN } from "@/lib/openai/models";

import { findCachedQuestion } from "./cache";
import { buildMcqPrompt, MCQ_PROMPT_VERSION } from "./prompts";
import { GeneratedMcqSchema, MCQ_JSON_SCHEMA, type GeneratedMcq } from "./schema";

export type GenerateMcqInput = {
  conceptId: string;
  difficulty: DifficultyLevel;
  thinkingStyle: ThinkingStyle | null;
  /** true のときキャッシュを使わず必ず新規生成 (開発用) */
  forceFresh?: boolean;
};

export type GenerateMcqResult = {
  question: Question;
  source: "cache" | "generated";
};

/** 直近 30 日の出題要約文 (prompt の重複回避ヒント用、retired を除外して新しい順) */
async function fetchPastSummaries(conceptId: string, max = 5): Promise<string[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await getDb()
    .select({ prompt: questions.prompt })
    .from(questions)
    .where(
      and(
        eq(questions.conceptId, conceptId),
        eq(questions.retired, false),
        gte(questions.createdAt, since),
      ),
    )
    .orderBy(desc(questions.createdAt))
    .limit(max);
  return rows.map((r) => r.prompt.slice(0, 60)).filter(Boolean);
}

async function loadConcept(conceptId: string): Promise<Concept> {
  const rows = await getDb().select().from(concepts).where(eq(concepts.id, conceptId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`unknown concept: ${conceptId}`);
  return row;
}

/** この concept で許可されている難易度以外を指定されたら弾く (questions テーブルの汚染防止) */
function assertDifficultyAllowed(concept: Concept, difficulty: DifficultyLevel): void {
  const allowed = concept.difficultyLevels;
  if (!allowed.includes(difficulty)) {
    throw new Error(
      `difficulty ${difficulty} is not allowed for concept ${concept.id} (allowed: ${allowed.join(",")})`,
    );
  }
}

/**
 * 最小キャッシュ件数。cache 件数が MIN_CACHE_COUNT 未満のときは必ず新規生成して
 * キャッシュを育てる。以降は 50/50 で cache hit / 新規生成を分岐 (docs/03 §3.3.4)。
 */
const MIN_CACHE_COUNT = 3;
const FRESH_GENERATION_RATIO = 0.5;

async function countCachedQuestions(params: {
  conceptId: string;
  difficulty: DifficultyLevel;
  thinkingStyle: ThinkingStyle | null;
}): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const db = getDb();
  const predicates = [
    eq(questions.conceptId, params.conceptId),
    eq(questions.type, "mcq"),
    eq(questions.difficulty, params.difficulty),
    eq(questions.retired, false),
    gte(questions.createdAt, since),
  ];
  if (params.thinkingStyle) {
    predicates.push(eq(questions.thinkingStyle, params.thinkingStyle));
  }
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(questions)
    .where(and(...predicates));
  return rows[0]?.count ?? 0;
}

/**
 * OpenAI Responses API で Structured Output (json_schema) を取得する。
 * dependency injection 可能にして snapshot / unit test で LLM を呼ばずに済むよう `llm` 引数で差し替え可能。
 */
export type McqLlmCaller = (args: {
  model: string;
  system: string;
  user: string;
}) => Promise<GeneratedMcq>;

export const defaultMcqLlm: McqLlmCaller = async ({ model, system, user }) => {
  const client = getOpenAI();
  const res = await client.responses.create({
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    text: {
      format: {
        type: "json_schema",
        ...MCQ_JSON_SCHEMA,
      },
    },
  });
  // 返却された output_text に JSON 文字列が入る。Zod でガード
  const parsed = JSON.parse(res.output_text);
  return GeneratedMcqSchema.parse(parsed);
};

export async function generateMcq(
  input: GenerateMcqInput,
  llm: McqLlmCaller = defaultMcqLlm,
): Promise<GenerateMcqResult> {
  const db = getDb();
  const concept = await loadConcept(input.conceptId);
  assertDifficultyAllowed(concept, input.difficulty);

  if (!input.forceFresh) {
    // キャッシュが十分育っていれば 50/50 で cache hit / 新規生成を選ぶ (docs/03 §3.3.4)
    const cacheCount = await countCachedQuestions({
      conceptId: input.conceptId,
      difficulty: input.difficulty,
      thinkingStyle: input.thinkingStyle,
    });
    const useCache = cacheCount >= MIN_CACHE_COUNT && Math.random() >= FRESH_GENERATION_RATIO;

    if (useCache) {
      const cached = await findCachedQuestion(db, {
        conceptId: input.conceptId,
        type: "mcq",
        thinkingStyle: input.thinkingStyle,
        difficulty: input.difficulty,
      });
      if (cached) {
        // キャッシュローテーション: serve_count を増やし last_served_at を更新することで、
        // 次回は未使用 (last_served_at IS NULL) の別問題が優先され、30d 内に出題が分散する
        const [updated] = await db
          .update(questions)
          .set({
            serveCount: sql`${questions.serveCount} + 1`,
            lastServedAt: new Date(),
          })
          .where(eq(questions.id, cached.id))
          .returning();
        return { question: updated ?? cached, source: "cache" };
      }
    }
  }

  const past = await fetchPastSummaries(input.conceptId);
  const { system, user } = buildMcqPrompt({
    concept,
    difficulty: input.difficulty,
    thinkingStyle: input.thinkingStyle,
    pastQuestionsSummary: past,
  });

  const generated = await llm({ model: MODEL_MAIN, system, user });

  const now = new Date();
  const [inserted] = await db
    .insert(questions)
    .values({
      conceptId: input.conceptId,
      type: "mcq",
      difficulty: input.difficulty,
      thinkingStyle: input.thinkingStyle,
      prompt: generated.prompt,
      answer: generated.answer,
      distractors: generated.distractors,
      hint: generated.hint,
      explanation: generated.explanation,
      tags: generated.tags,
      generatedBy: MODEL_MAIN,
      promptVersion: MCQ_PROMPT_VERSION,
      // 新規問題は出題時点で配信済みとマークする (次回は別問題が未使用として優先される)
      serveCount: 1,
      lastServedAt: now,
    })
    .returning();

  if (!inserted) throw new Error("failed to insert generated question");
  return { question: inserted, source: "generated" };
}
