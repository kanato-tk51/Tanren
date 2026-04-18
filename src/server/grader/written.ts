import type { Question, RubricCheck } from "@/db/schema";
import { getOpenAI } from "@/lib/openai/client";
import { MODEL_MAIN } from "@/lib/openai/models";

import { renderTemplate } from "../generator/prompt-template";
import { GradedShortSchema, SHORT_JSON_SCHEMA, type GradedShort } from "./schema";

export const WRITTEN_PROMPT_VERSION = "written.v1";
const WRITTEN_TEMPLATE_PATH = "grading/written.v1.md";

const CORRECT_THRESHOLD = 0.7;

export type WrittenGradingInput = {
  question: Pick<Question, "prompt" | "answer" | "rubric">;
  userAnswer: string;
};

function formatRubric(rubric: RubricCheck[] | null | undefined): string {
  if (!rubric || rubric.length === 0) return "(none)";
  return rubric
    .map((r) => `- id=${r.id}: ${r.description}${r.weight ? ` (weight=${r.weight})` : ""}`)
    .join("\n");
}

export function buildWrittenGradingPrompt(input: WrittenGradingInput) {
  return renderTemplate(WRITTEN_TEMPLATE_PATH, {
    questionPrompt: input.question.prompt,
    expectedAnswer: input.question.answer,
    rubric: formatRubric(input.question.rubric),
    userAnswer: input.userAnswer,
  });
}

export type WrittenLlmCaller = (args: {
  model: string;
  system: string;
  user: string;
}) => Promise<GradedShort>;

export const defaultWrittenLlm: WrittenLlmCaller = async ({ model, system, user }) => {
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
        ...SHORT_JSON_SCHEMA, // 採点結果の schema は short と同じ (score/correct/feedback/rubricChecks)
      },
    },
  });
  return GradedShortSchema.parse(JSON.parse(res.output_text));
};

/** written 採点は gpt-5。score から correct を導出 (LLM 自己申告は信用しない) */
export async function gradeWritten(
  input: WrittenGradingInput,
  llm: WrittenLlmCaller = defaultWrittenLlm,
) {
  const { system, user } = buildWrittenGradingPrompt(input);
  const graded = await llm({ model: MODEL_MAIN, system, user });
  return {
    ...graded,
    correct: graded.score >= CORRECT_THRESHOLD,
    model: MODEL_MAIN,
    promptVersion: WRITTEN_PROMPT_VERSION,
  };
}
