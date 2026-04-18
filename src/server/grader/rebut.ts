import type { Question, RubricCheck } from "@/db/schema";
import { getOpenAI } from "@/lib/openai/client";
import { MODEL_MAIN } from "@/lib/openai/models";

import { renderTemplate } from "../generator/prompt-template";
import { GradedShortSchema, SHORT_JSON_SCHEMA, type GradedShort } from "./schema";

export const REBUT_PROMPT_VERSION = "rebut.v1";
const REBUT_TEMPLATE_PATH = "grading/rebut.v1.md";

const CORRECT_THRESHOLD = 0.7;

export type RebutGradingInput = {
  question: Pick<Question, "prompt" | "answer" | "rubric">;
  userAnswer: string;
  /** ユーザーが主張する反論 (「これは正解だ」の根拠) */
  rebuttalMessage: string;
  /** 元の採点結果 (feedback / correct / score) */
  original: {
    correct: boolean | null;
    score: number | null;
    feedback: string | null;
  };
};

function formatRubric(rubric: RubricCheck[] | null | undefined): string {
  if (!rubric || rubric.length === 0) {
    return "(採点ルーブリックなし。Expected answer との意味一致で判断すること)";
  }
  return rubric
    .map((r) => `- id=${r.id}: ${r.description}${r.weight ? ` (weight=${r.weight})` : ""}`)
    .join("\n");
}

function formatOriginalGrading(original: RebutGradingInput["original"]): string {
  const correct =
    original.correct === true ? "正解" : original.correct === false ? "不正解" : "未判定";
  const score = original.score ?? "未評価";
  return `判定: ${correct} / score=${score}\nfeedback: ${original.feedback ?? "(なし)"}`;
}

export function buildRebutPrompt(input: RebutGradingInput) {
  return renderTemplate(REBUT_TEMPLATE_PATH, {
    questionPrompt: input.question.prompt,
    expectedAnswer: input.question.answer,
    rubric: formatRubric(input.question.rubric),
    userAnswer: input.userAnswer,
    originalGrading: formatOriginalGrading(input.original),
    rebuttalMessage: input.rebuttalMessage,
  });
}

export type RebutLlmCaller = (args: {
  model: string;
  system: string;
  user: string;
}) => Promise<GradedShort>;

export const defaultRebutLlm: RebutLlmCaller = async ({ model, system, user }) => {
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
        ...SHORT_JSON_SCHEMA, // 採点結果 schema は short と同形
      },
    },
  });
  return GradedShortSchema.parse(JSON.parse(res.output_text));
};

/**
 * 再採点は main モデル (gpt-5) で行う。ユーザーが不服を表明したケースなので
 * mini よりも慎重な判定が欲しいため。score から correct を導出し、LLM 自己申告は信用しない。
 */
export async function gradeRebut(
  input: RebutGradingInput,
  llm: RebutLlmCaller = defaultRebutLlm,
): Promise<GradedShort & { model: string; promptVersion: string }> {
  const { system, user } = buildRebutPrompt(input);
  const graded = await llm({ model: MODEL_MAIN, system, user });
  return {
    ...graded,
    correct: graded.score >= CORRECT_THRESHOLD,
    model: MODEL_MAIN,
    promptVersion: REBUT_PROMPT_VERSION,
  };
}
