import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { misconceptions, type Concept, type Question } from "@/db/schema";
import { getOpenAI } from "@/lib/openai/client";
import { MODEL_MAIN } from "@/lib/openai/models";

import { renderTemplate } from "../generator/prompt-template";

/**
 * 類似 description のマージ判定用 normalize。
 * - trim
 * - 連続する空白を 1 つに
 * - lower (ASCII のみ)
 * - 末尾の句点「。.」を削る
 * 完全に意味的な同義判定ではないが、LLM 表現の軽微な揺れ
 * (大小文字 / 末尾句点 / 余計な空白) を吸収して count 加算ヒットさせる。
 */
export function normalizeMisconceptionDescription(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[。.]+$/u, "")
    .trim();
}

export const EXTRACT_MISCONCEPTION_PROMPT_VERSION = "extract-misconception.v1";
const TEMPLATE_PATH = "grading/extract-misconception.v1.md";

// prompt の「最大 100 文字」と合わせる。LLM が多少超過することは許容して max は少し緩め。
const MisconceptionSchema = z.object({
  description: z.string().max(100),
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
      description: { type: "string", maxLength: 100 },
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
    // normalize して保存キーを安定化させる (類似揺れを 1 行に集約)
    description: normalizeMisconceptionDescription(parsed.description),
  });
  return { saved: true, extracted: parsed };
}

/**
 * user × concept × description (normalize 済み) の misconception を upsert。
 * uq_misconceptions_user_concept_desc の一意制約に乗せて ON CONFLICT DO UPDATE で
 * 原子的に count +1 する (並行誤答での重複行生成を防ぐ、Codex Round 1 P0)。
 *
 * description は normalizeMisconceptionDescription で事前に正規化すること
 * (大小文字・末尾句点・空白を吸収)。
 */
export async function upsertMisconception(params: {
  userId: string;
  conceptId: string;
  description: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(misconceptions)
    .values({
      userId: params.userId,
      conceptId: params.conceptId,
      description: params.description,
    })
    .onConflictDoUpdate({
      target: [misconceptions.userId, misconceptions.conceptId, misconceptions.description],
      set: {
        count: sql`${misconceptions.count} + 1`,
        lastSeen: sql`now()`,
      },
    });
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
