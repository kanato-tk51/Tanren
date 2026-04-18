/**
 * OpenAI モデル ID の定数。docs/03-ai-strategy.md §3.0 が真実の源。
 * モデル名が更新されたらここを一箇所だけ直す (文字列リテラル散在禁止)。
 */
export const MODEL_MAIN = "gpt-5" as const;
export const MODEL_CHEAP = "gpt-5-mini" as const;

export type OpenAIModelId = typeof MODEL_MAIN | typeof MODEL_CHEAP;
