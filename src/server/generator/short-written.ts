import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  concepts,
  questions,
  type Concept,
  type DifficultyLevel,
  type Question,
  type QuestionType,
  type ThinkingStyle,
} from "@/db/schema";
import { getOpenAI } from "@/lib/openai/client";
import { MODEL_MAIN } from "@/lib/openai/models";

import { findCachedQuestion } from "./cache";
import { renderTemplate } from "./prompt-template";
import { styleInstruction } from "./prompts";
import {
  GeneratedShortWrittenSchema,
  SHORT_WRITTEN_JSON_SCHEMA,
  type GeneratedShortWritten,
} from "./short-written-schema";

/**
 * short / written の生成。mcq と同じ `prompts/generation/{short,written}.v1.md` を読む。
 * JSON schema に distractors はない代わりに rubric が必須。
 */

const PROMPT_VERSIONS = {
  short: "short.v1",
  written: "written.v1",
} as const;

const TEMPLATE_PATHS = {
  short: "generation/short.v1.md",
  written: "generation/written.v1.md",
} as const;

export type GenerateShortWrittenInput = {
  conceptId: string;
  type: "short" | "written";
  difficulty: DifficultyLevel;
  thinkingStyle: ThinkingStyle | null;
  forceFresh?: boolean;
};

export type GenerateShortWrittenResult = {
  question: Question;
  source: "cache" | "generated";
};

export type ShortWrittenLlmCaller = (args: {
  model: string;
  system: string;
  user: string;
}) => Promise<GeneratedShortWritten>;

export const defaultShortWrittenLlm: ShortWrittenLlmCaller = async ({ model, system, user }) => {
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
        ...SHORT_WRITTEN_JSON_SCHEMA,
      },
    },
  });
  return GeneratedShortWrittenSchema.parse(JSON.parse(res.output_text));
};

async function loadConcept(conceptId: string): Promise<Concept> {
  const rows = await getDb().select().from(concepts).where(eq(concepts.id, conceptId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`unknown concept: ${conceptId}`);
  return row;
}

function assertDifficultyAllowed(concept: Concept, difficulty: DifficultyLevel): void {
  if (!concept.difficultyLevels.includes(difficulty)) {
    throw new Error(
      `difficulty ${difficulty} not allowed for concept ${concept.id} (allowed: ${concept.difficultyLevels.join(",")})`,
    );
  }
}

export async function generateShortWritten(
  input: GenerateShortWrittenInput,
  llm: ShortWrittenLlmCaller = defaultShortWrittenLlm,
): Promise<GenerateShortWrittenResult> {
  const db = getDb();
  const concept = await loadConcept(input.conceptId);
  assertDifficultyAllowed(concept, input.difficulty);

  if (!input.forceFresh) {
    const cached = await findCachedQuestion(db, {
      conceptId: input.conceptId,
      type: input.type as QuestionType,
      thinkingStyle: input.thinkingStyle,
      difficulty: input.difficulty,
    });
    // short/written はまだ cache ローテーション戦略が未成熟なので、cache があれば返す
    if (cached) return { question: cached, source: "cache" };
  }

  const rendered = renderTemplate(TEMPLATE_PATHS[input.type], {
    conceptId: concept.id,
    conceptName: concept.name,
    conceptDescription: concept.description ?? "(none)",
    domainId: concept.domainId,
    subdomainId: concept.subdomainId,
    difficulty: input.difficulty,
    thinkingStyle: input.thinkingStyle ?? "(none)",
    styleInstruction: styleInstruction(input.thinkingStyle),
    pastQuestionsSummary: "(none)",
  });

  const generated = await llm({ model: MODEL_MAIN, system: rendered.system, user: rendered.user });

  const [inserted] = await db
    .insert(questions)
    .values({
      conceptId: input.conceptId,
      type: input.type,
      difficulty: input.difficulty,
      thinkingStyle: input.thinkingStyle,
      prompt: generated.prompt,
      answer: generated.answer,
      rubric: generated.rubric,
      hint: generated.hint,
      explanation: generated.explanation,
      tags: generated.tags,
      generatedBy: MODEL_MAIN,
      promptVersion: PROMPT_VERSIONS[input.type],
      serveCount: 1,
      lastServedAt: new Date(),
    })
    .returning();

  if (!inserted) throw new Error("failed to insert generated question");
  return { question: inserted, source: "generated" };
}
