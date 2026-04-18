import { eq } from "drizzle-orm";

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

/** 直近出題の要約文 (重複回避ヒント用) */
async function fetchPastSummaries(conceptId: string, max = 5): Promise<string[]> {
  const rows = await getDb()
    .select({ prompt: questions.prompt })
    .from(questions)
    .where(eq(questions.conceptId, conceptId))
    .limit(max);
  return rows.map((r) => r.prompt.slice(0, 60)).filter(Boolean);
}

async function loadConcept(conceptId: string): Promise<Concept> {
  const rows = await getDb().select().from(concepts).where(eq(concepts.id, conceptId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`unknown concept: ${conceptId}`);
  return row;
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

  if (!input.forceFresh) {
    const cached = await findCachedQuestion(db, {
      conceptId: input.conceptId,
      type: "mcq",
      thinkingStyle: input.thinkingStyle,
      difficulty: input.difficulty,
    });
    if (cached) return { question: cached, source: "cache" };
  }

  const concept = await loadConcept(input.conceptId);
  const past = await fetchPastSummaries(input.conceptId);
  const { system, user } = buildMcqPrompt({
    concept,
    difficulty: input.difficulty,
    thinkingStyle: input.thinkingStyle,
    pastQuestionsSummary: past,
  });

  const generated = await llm({ model: MODEL_MAIN, system, user });

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
    })
    .returning();

  if (!inserted) throw new Error("failed to insert generated question");
  return { question: inserted, source: "generated" };
}
