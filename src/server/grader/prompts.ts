import type { Question, RubricCheck } from "@/db/schema";

import { renderTemplate } from "../generator/prompt-template";

export const SHORT_PROMPT_VERSION = "short.v1";
const SHORT_TEMPLATE_PATH = "grading/short.v1.md";

export type ShortGradingInput = {
  question: Pick<Question, "prompt" | "answer" | "rubric">;
  userAnswer: string;
};

function formatRubric(rubric: RubricCheck[] | null | undefined): string {
  if (!rubric || rubric.length === 0) {
    return "(採点ルーブリックなし。Expected answer との意味一致で判断すること)";
  }
  return rubric
    .map((r) => `- id=${r.id}: ${r.description}${r.weight ? ` (weight=${r.weight})` : ""}`)
    .join("\n");
}

export function buildShortGradingPrompt(input: ShortGradingInput): {
  system: string;
  user: string;
} {
  return renderTemplate(SHORT_TEMPLATE_PATH, {
    questionPrompt: input.question.prompt,
    expectedAnswer: input.question.answer,
    rubric: formatRubric(input.question.rubric),
    userAnswer: input.userAnswer,
  });
}
