import {
  DIFFICULTY_LEVELS,
  DOMAIN_IDS,
  QUESTION_TYPES,
  THINKING_STYLES,
} from "@/db/schema/_constants";
import { getOpenAI } from "@/lib/openai/client";
import { MODEL_CHEAP } from "@/lib/openai/models";

import { renderTemplate } from "../generator/prompt-template";
import {
  CUSTOM_SESSION_JSON_SCHEMA,
  CustomSessionSpecSchema,
  type CustomSessionSpec,
} from "./schema";

export const CUSTOM_SESSION_PARSER_PROMPT_VERSION = "custom-session.v1";
const CUSTOM_SESSION_TEMPLATE_PATH = "parsing/custom-session.v1.md";

export function buildCustomSessionPrompt(rawRequest: string) {
  return renderTemplate(CUSTOM_SESSION_TEMPLATE_PATH, {
    rawRequest: rawRequest.trim(),
    availableDomains: DOMAIN_IDS.join(", "),
    availableThinkingStyles: THINKING_STYLES.join(", "),
    availableQuestionTypes: QUESTION_TYPES.join(", "),
    availableDifficultyLevels: DIFFICULTY_LEVELS.join(", "),
  });
}

export type CustomSessionParserCaller = (args: {
  model: string;
  system: string;
  user: string;
}) => Promise<unknown>;

export const defaultCustomSessionParserCaller: CustomSessionParserCaller = async ({
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
        ...CUSTOM_SESSION_JSON_SCHEMA,
      },
    },
  });
  return JSON.parse(res.output_text);
};

/**
 * 自然言語の Custom Session リクエストを `CustomSessionSpec` にパースする (issue #17)。
 * gpt-5-mini + Structured Outputs を使い、最終的に Zod でもバリデートする。
 */
export async function parseCustomSession(
  rawRequest: string,
  caller: CustomSessionParserCaller = defaultCustomSessionParserCaller,
): Promise<{ spec: CustomSessionSpec; promptVersion: string; model: string }> {
  const { system, user } = buildCustomSessionPrompt(rawRequest);
  const raw = await caller({ model: MODEL_CHEAP, system, user });
  const spec = CustomSessionSpecSchema.parse(raw);
  return {
    spec,
    promptVersion: CUSTOM_SESSION_PARSER_PROMPT_VERSION,
    model: MODEL_CHEAP,
  };
}
