import type { Concept, DifficultyLevel, ThinkingStyle } from "@/db/schema";

import { renderTemplate } from "./prompt-template";

/** 生成プロンプトのテンプレ版。docs/03-ai-strategy.md §3.3 参照 */
export const MCQ_PROMPT_VERSION = "mcq.v1";
const MCQ_TEMPLATE_PATH = "generation/mcq.v1.md";

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
 * `prompts/generation/mcq.v1.md` を読み込んで変数置換し system/user を返す。
 * テンプレは markdown が真実の源 (CLAUDE.md §4.5)。このラッパはドメイン固有の
 * 補助辞書 (思考スタイル説明) と過去履歴の整形のみを担う。
 */
export function buildMcqPrompt(input: McqPromptInput): {
  system: string;
  user: string;
} {
  const past =
    input.pastQuestionsSummary.length === 0
      ? "(none)"
      : input.pastQuestionsSummary.map((s) => `- ${s}`).join("\n");

  return renderTemplate(MCQ_TEMPLATE_PATH, {
    conceptId: input.concept.id,
    conceptName: input.concept.name,
    conceptDescription: input.concept.description ?? "(none)",
    domainId: input.concept.domainId,
    subdomainId: input.concept.subdomainId,
    difficulty: input.difficulty,
    thinkingStyle: input.thinkingStyle ?? "(none)",
    styleInstruction: styleInstruction(input.thinkingStyle),
    pastQuestionsSummary: past,
  });
}
