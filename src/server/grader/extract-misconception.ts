import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { misconceptions, type Concept, type Question } from "@/db/schema";
import { getOpenAI } from "@/lib/openai/client";
import { MODEL_MAIN } from "@/lib/openai/models";

import { renderTemplate } from "../generator/prompt-template";

export const EXTRACT_MISCONCEPTION_PROMPT_VERSION = "extract-misconception.v1";
const TEMPLATE_PATH = "grading/extract-misconception.v1.md";

const MisconceptionSchema = z.object({
  description: z.string().max(200),
  confidence: z.number().min(0).max(1),
});

export type ExtractedMisconception = z.infer<typeof MisconceptionSchema>;

const JSON_SCHEMA = {
  name: "misconception_extraction",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["description", "confidence"],
    properties: {
      description: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  },
};

export type ExtractMisconceptionInput = {
  concept: Pick<Concept, "id" | "name">;
  question: Pick<Question, "prompt" | "answer">;
  userAnswer: string;
  reasonGiven: string;
};

export function buildExtractMisconceptionPrompt(input: ExtractMisconceptionInput) {
  return renderTemplate(TEMPLATE_PATH, {
    conceptId: input.concept.id,
    conceptName: input.concept.name,
    questionPrompt: input.question.prompt,
    expectedAnswer: input.question.answer,
    userAnswer: input.userAnswer,
    reasonGiven: input.reasonGiven,
  });
}

export type ExtractMisconceptionCaller = (args: {
  model: string;
  system: string;
  user: string;
}) => Promise<unknown>;

export const defaultExtractMisconceptionCaller: ExtractMisconceptionCaller = async ({
  model,
  system,
  user,
}) => {
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
        ...JSON_SCHEMA,
      },
    },
  });
  return JSON.parse(res.output_text);
};

/**
 * 誤答 + reason_given から誤概念を抽出 (issue #19)。
 * - reason_given が空なら抽出スキップ (コスト節約。docs/03 §3.4.1)
 * - confidence < 0.5 の抽出は保存しない (迎合的な強引な診断を避ける)
 *
 * 抽出した誤概念は同 user × concept × description 一致 (lowercased normalize) で
 * upsert され、count が +1 される。
 */
export async function extractAndPersistMisconception(
  input: ExtractMisconceptionInput & { userId: string },
  caller: ExtractMisconceptionCaller = defaultExtractMisconceptionCaller,
): Promise<{ saved: boolean; extracted: ExtractedMisconception | null }> {
  if (!input.reasonGiven || input.reasonGiven.trim().length === 0) {
    return { saved: false, extracted: null };
  }

  const { system, user } = buildExtractMisconceptionPrompt(input);
  const raw = await caller({ model: MODEL_MAIN, system, user });
  const parsed = MisconceptionSchema.parse(raw);

  if (parsed.confidence < 0.5 || parsed.description.trim().length === 0) {
    return { saved: false, extracted: parsed };
  }

  await upsertMisconception({
    userId: input.userId,
    conceptId: input.concept.id,
    description: parsed.description.trim(),
  });
  return { saved: true, extracted: parsed };
}

/**
 * user × concept × description (1文字単位の完全一致) の misconception を upsert する。
 * 既存があれば count +1 + last_seen 更新、なければ INSERT。
 *
 * 注意: description 完全一致は LLM の表現揺れに弱いため、docs/03 §3.4.1 にある「類似判定」
 * (LLM での近似マッチ or embedding) は Phase 5+ で上乗せ。MVP はこのまま文字列一致。
 */
export async function upsertMisconception(params: {
  userId: string;
  conceptId: string;
  description: string;
}): Promise<void> {
  const db = getDb();
  const existing = await db
    .select()
    .from(misconceptions)
    .where(
      and(
        eq(misconceptions.userId, params.userId),
        eq(misconceptions.conceptId, params.conceptId),
        eq(misconceptions.description, params.description),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(misconceptions)
      .set({
        count: sql`${misconceptions.count} + 1`,
        lastSeen: sql`now()`,
      })
      .where(eq(misconceptions.id, existing[0].id));
  } else {
    await db.insert(misconceptions).values({
      userId: params.userId,
      conceptId: params.conceptId,
      description: params.description,
    });
  }
}

/**
 * 生成プロンプトへの注入用: 特定 concept 上で未解決 (resolved=false) かつ直近で count 上位の
 * 誤概念を最大 N 件返す。docs/03 §3.4.1 「出題時に矯正指示を注入」の入口。
 */
export async function fetchUnresolvedMisconceptionsForGeneration(params: {
  userId: string;
  conceptId: string;
  limit?: number;
}): Promise<Pick<typeof misconceptions.$inferSelect, "description" | "count">[]> {
  const db = getDb();
  const limit = params.limit ?? 3;
  const rows = await db
    .select()
    .from(misconceptions)
    .where(
      and(
        eq(misconceptions.userId, params.userId),
        eq(misconceptions.conceptId, params.conceptId),
        eq(misconceptions.resolved, false),
      ),
    )
    .orderBy(sql`${misconceptions.count} DESC`, sql`${misconceptions.lastSeen} DESC`)
    .limit(limit);
  return rows.map((r) => ({ description: r.description, count: r.count }));
}
