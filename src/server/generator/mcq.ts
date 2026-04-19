import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

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

import { fetchUnresolvedMisconceptionsForGeneration } from "../grader/extract-misconception";

import { CACHE_WINDOW_DAYS, findCachedQuestion } from "./cache";
import { buildMcqPrompt, MCQ_PROMPT_VERSION } from "./prompts";
import { GeneratedMcqSchema, MCQ_JSON_SCHEMA, type GeneratedMcq } from "./schema";

export type GenerateMcqInput = {
  conceptId: string;
  difficulty: DifficultyLevel;
  thinkingStyle: ThinkingStyle | null;
  /** true のときキャッシュを使わず必ず新規生成 (開発用) */
  forceFresh?: boolean;
  /**
   * 指定されると prompt に「この concept で繰り返している誤概念」を矯正指示として
   * 注入する (issue #19, docs/03 §3.4.1)。未指定なら注入しない。
   */
  userId?: string;
  /**
   * 生成した問題を「配信済み」としてマークするか (default: true)。
   * 通常 request path では出題と同時に insert するので true (serveCount=1, lastServedAt=now)。
   * pregen path (issue #39) では insert だけ先に行いユーザーにはまだ配信していないので
   * false を渡す。false なら serveCount=0, lastServedAt=null で「untouched inventory」扱いになり
   * findCachedQuestion の「未使用を優先」ソートで最優先になる (Codex Round 2 指摘)。
   */
  markAsServed?: boolean;
};

export type GenerateMcqResult = {
  question: Question;
  source: "cache" | "generated";
};

/** 直近 30 日の出題要約文 (prompt の重複回避ヒント用、retired を除外して新しい順) */
async function fetchPastSummaries(conceptId: string, max = 5): Promise<string[]> {
  const since = new Date(Date.now() - CACHE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
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
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Unknown concept: ${conceptId}`,
    });
  }
  return row;
}

/** この concept で許可されている難易度以外を指定されたら弾く (questions テーブルの汚染防止) */
function assertDifficultyAllowed(concept: Concept, difficulty: DifficultyLevel): void {
  const allowed = concept.difficultyLevels;
  if (!allowed.includes(difficulty)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `difficulty "${difficulty}" is not allowed for concept ${concept.id} (allowed: ${allowed.join(", ")})`,
    });
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
  const since = new Date(Date.now() - CACHE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const db = getDb();
  const predicates = [
    eq(questions.conceptId, params.conceptId),
    eq(questions.type, "mcq"),
    eq(questions.difficulty, params.difficulty),
    eq(questions.retired, false),
    gte(questions.createdAt, since),
  ];
  // thinkingStyle の null/値 ともに lookup (findCachedQuestion) と同じキーで絞る。
  // 片側だけ合算すると MIN_CACHE_COUNT 判定が崩れて 50/50 分岐が早まる。
  predicates.push(
    params.thinkingStyle === null
      ? isNull(questions.thinkingStyle)
      : eq(questions.thinkingStyle, params.thinkingStyle),
  );
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

  // 誤概念矯正モード: ユーザーが繰り返している誤解がある場合、その矯正を狙う問題は
  // user-specific。共有 questions キャッシュを汚染しないよう、このパスでは cache を
  // 一切使わず / 書き込みもせず必ず新規生成する (Codex Round 2 P1-b)。
  const userMisconceptions = input.userId
    ? await fetchUnresolvedMisconceptionsForGeneration({
        userId: input.userId,
        conceptId: input.conceptId,
      })
    : [];
  const correctiveMode = userMisconceptions.length > 0;

  if (!input.forceFresh && !correctiveMode) {
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
    userMisconceptions,
  });

  const generated = await llm({ model: MODEL_MAIN, system, user });

  const now = new Date();
  // markAsServed の default は「request path 経由で直ちに配信される前提」の true。
  // pregen (issue #39) は false を渡して untouched inventory として残し、findCachedQuestion
  // の「last_served_at IS NULL DESC」で最優先される状態にする。
  const markAsServed = input.markAsServed ?? true;
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
      // 配信済みなら serveCount=1 / lastServedAt=now、untouched ストックなら 0 / null。
      // 誤概念矯正モード (user-specific な prompt で生成された問題) は共有キャッシュを
      // 汚染しないよう retired=true で保存し、cache 検索対象から除外する
      // (Codex Round 2 P1-b)。
      serveCount: markAsServed ? 1 : 0,
      lastServedAt: markAsServed ? now : null,
      retired: correctiveMode,
      retiredReason: correctiveMode ? "corrective (user-specific misconception)" : null,
    })
    .returning();

  if (!inserted) throw new Error("failed to insert generated question");
  return { question: inserted, source: "generated" };
}
