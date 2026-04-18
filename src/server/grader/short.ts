import { getOpenAI } from "@/lib/openai/client";
import { MODEL_CHEAP } from "@/lib/openai/models";

import { buildShortGradingPrompt, type ShortGradingInput } from "./prompts";
import { GradedShortSchema, SHORT_JSON_SCHEMA, type GradedShort } from "./schema";

export type ShortLlmCaller = (args: {
  model: string;
  system: string;
  user: string;
}) => Promise<GradedShort>;

export const defaultShortLlm: ShortLlmCaller = async ({ model, system, user }) => {
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
        ...SHORT_JSON_SCHEMA,
      },
    },
  });
  return GradedShortSchema.parse(JSON.parse(res.output_text));
};

/**
 * short answer を gpt-5-mini にルーブリック採点させる (docs/03 §3.4.2)。
 * LLM 呼び出しは DI 可能 (テスト時に差し替え)。
 */
/** 採点結果の `correct` は LLM の自己申告を信用せず score から導出 (docs/03 §3.4.2) */
const CORRECT_THRESHOLD = 0.7;

export async function gradeShort(
  input: ShortGradingInput,
  llm: ShortLlmCaller = defaultShortLlm,
): Promise<GradedShort & { model: string; promptVersion: string }> {
  const { system, user } = buildShortGradingPrompt(input);
  const graded = await llm({ model: MODEL_CHEAP, system, user });
  return {
    ...graded,
    correct: graded.score >= CORRECT_THRESHOLD,
    model: MODEL_CHEAP,
    promptVersion: "short.v1",
  };
}
