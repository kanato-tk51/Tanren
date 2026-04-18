import type { Concept, DifficultyLevel, ThinkingStyle } from "@/db/schema";

/** 生成プロンプトのテンプレ版。docs/03-ai-strategy.md §3.3 参照 */
export const MCQ_PROMPT_VERSION = "mcq.v1";

const STYLE_INSTRUCTION_MAP: Record<ThinkingStyle, string> = {
  why: "問題は「なぜそうなっているか」「理由を説明せよ」形式。表面的な定義を問わないこと。",
  how: "実際の手順や選び方を問う。状況を具体化して実務寄りにすること。",
  trade_off: "複数の選択肢/アプローチの利点と欠点を比較させる問題にすること。",
  edge_case: "通常ケースではなく、境界条件・異常系・稀な条件下の挙動を問うこと。",
  compare: "二つ以上の概念を並べて差を問う。違いが最も本質的な選択肢を正解に。",
  apply: "本番運用で起きうる具体的なシナリオに置き換えて、判断を問うこと。",
};

export function styleInstruction(style: ThinkingStyle | null | undefined): string {
  if (!style) return "思考様式は特に指定なし。自然な出題で。";
  return STYLE_INSTRUCTION_MAP[style];
}

export type McqPromptInput = {
  concept: Pick<Concept, "id" | "name" | "description" | "domainId" | "subdomainId">;
  difficulty: DifficultyLevel;
  thinkingStyle: ThinkingStyle | null;
  /** 直近 30 日の既出問題の要約。文字列の配列で渡す。空配列なら "(none)" を出す */
  pastQuestionsSummary: string[];
};

/**
 * mcq プロンプトを組み立てる。
 * OpenAI の prompt caching は「共通 prefix が長いほど効きやすい」ので、
 * variant が多い箇所 (concept / 履歴) は後ろに回し、固定文は前に置く。
 */
export function buildMcqPrompt(input: McqPromptInput): {
  system: string;
  user: string;
} {
  const system =
    "You are a senior engineer creating a multiple-choice quiz question for a professional software engineer.\n" +
    "Output strictly as JSON matching the provided schema. Use 日本語 (Japanese) for all human-readable fields.";

  const past =
    input.pastQuestionsSummary.length === 0
      ? "(none)"
      : input.pastQuestionsSummary.map((s) => `- ${s}`).join("\n");

  const user = [
    "## Concept",
    `id: ${input.concept.id}`,
    `name: ${input.concept.name}`,
    `description: ${input.concept.description ?? "(none)"}`,
    `domain: ${input.concept.domainId}`,
    `subdomain: ${input.concept.subdomainId}`,
    "",
    "## Spec",
    `difficulty: ${input.difficulty}`,
    `thinking_style: ${input.thinkingStyle ?? "(none)"}`,
    "",
    "## Style instruction",
    styleInstruction(input.thinkingStyle),
    "",
    "## Avoid duplicates",
    "Past recent framings for this concept (last 30 days, if any):",
    past,
  ].join("\n");

  return { system, user };
}
