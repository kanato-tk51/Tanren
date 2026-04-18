import OpenAI from "openai";

import { env } from "@/lib/env";

let cached: OpenAI | undefined;

/**
 * OpenAI SDK のシングルトン。ドメインロジックから `openai.*` を直接呼ばず、
 * 必ず src/server/generator / src/server/grader 等のラッパ経由で使うこと (CLAUDE.md §4.6)。
 */
export function getOpenAI(): OpenAI {
  cached ??= new OpenAI({ apiKey: env.openaiApiKey() });
  return cached;
}
