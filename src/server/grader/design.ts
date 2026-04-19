import "server-only";

import { z } from "zod";

import type { DialogueTurn, Question, RubricCheckResult } from "@/db/schema";
import { getOpenAI } from "@/lib/openai/client";
import { MODEL_MAIN } from "@/lib/openai/models";

/** 対話採点の LLM レスポンス schema (prompts/grading/design.v1.md と同期)。 */
const DesignResponseSchema = z.object({
  finalized: z.boolean(),
  nextQuestion: z.string().nullable(),
  score: z.number().min(0).max(1).nullable(),
  feedback: z.string().nullable(),
  rubricChecks: z
    .array(
      z.object({
        id: z.string(),
        passed: z.boolean(),
        comment: z.string().optional(),
      }),
    )
    .nullable(),
});
export type DesignResponse = z.infer<typeof DesignResponseSchema>;

const DESIGN_JSON_SCHEMA = {
  name: "design_response",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["finalized", "nextQuestion", "score", "feedback", "rubricChecks"],
    properties: {
      finalized: { type: "boolean" },
      nextQuestion: { type: ["string", "null"] },
      score: { type: ["number", "null"], minimum: 0, maximum: 1 },
      feedback: { type: ["string", "null"] },
      rubricChecks: {
        type: ["array", "null"],
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "passed"],
          properties: {
            id: { type: "string" },
            passed: { type: "boolean" },
            comment: { type: "string" },
          },
        },
      },
    },
  },
  strict: true,
} as const;

export const DESIGN_MAX_AI_TURNS = 3;
export const DESIGN_PROMPT_VERSION = "design.v1";

/** AI のターン回数をカウント (role === 'ai' の turn 数)。3 に達していたら必ず finalize させる。 */
export function countAiTurns(turns: DialogueTurn[]): number {
  return turns.filter((t) => t.role === "ai").length;
}

/** DI 用の caller 型。テストで差し替える */
export type DesignLlmCaller = (args: {
  model: string;
  system: string;
  user: string;
}) => Promise<DesignResponse>;

export const defaultDesignLlm: DesignLlmCaller = async ({ model, system, user }) => {
  const client = getOpenAI();
  const res = await client.responses.create({
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    text: { format: { type: "json_schema", ...DESIGN_JSON_SCHEMA } },
  });
  return DesignResponseSchema.parse(JSON.parse(res.output_text));
};

type GradeArgs = {
  question: Pick<Question, "prompt">;
  initialUserAnswer: string;
  turns: DialogueTurn[];
};

/** 現在の dialogue state から LLM に渡す system / user プロンプトを構築する */
export function buildDesignPrompt(args: GradeArgs): {
  system: string;
  user: string;
  forceFinalize: boolean;
  turnCount: number;
} {
  const turnCount = countAiTurns(args.turns);
  const forceFinalize = turnCount >= DESIGN_MAX_AI_TURNS - 1;

  const system =
    "あなたは熟練したソフトウェア設計レビュアー。1 問 3 ターン以内で学習者の設計回答を採点する。" +
    "出力は必ず指定 JSON schema に沿い、前後に地の文を付けない。" +
    "採点ルーブリック (0.25 点ずつ): scale / reliability / trade_off / specificity。" +
    "合計 ≥ 0.8 で correct、0.4-0.8 で partial、<0.4 で incorrect。" +
    (forceFinalize
      ? " 今回は最終ターン (turnCount == MAX - 1): 必ず finalized=true でスコアを出す。"
      : " まだ途中。観点が尽きていなければ 1 つだけ掘り下げ質問を返す (finalized=false)。");

  const history = args.turns.map((t) => `[${t.role}] ${t.message}`).join("\n");
  const user =
    `問題: ${args.question.prompt}\n\n` +
    `初回回答: ${args.initialUserAnswer}\n\n` +
    (history ? `対話履歴:\n${history}\n\n` : "") +
    `turnCount=${turnCount} (max=${DESIGN_MAX_AI_TURNS})。${forceFinalize ? "最終ターン、必ず finalize してください。" : "次のターンを返してください。"}`;

  return { system, user, forceFinalize, turnCount };
}

/**
 * design タイプ 1 ターン分の LLM 呼び出し。
 * forceFinalize のときに LLM が finalized=false で返したら強制確定 (指示違反防御)。
 */
export async function runDesignTurn(
  args: GradeArgs,
  llm: DesignLlmCaller = defaultDesignLlm,
): Promise<DesignResponse> {
  const { system, user, forceFinalize } = buildDesignPrompt(args);
  let data: DesignResponse;
  try {
    data = await llm({ model: MODEL_MAIN, system, user });
  } catch {
    // LLM が出力形式を壊したら中間点で safe finalize
    return {
      finalized: true,
      nextQuestion: null,
      score: 0.4,
      feedback: "採点応答のフォーマットが壊れていました。中間点で確定します。",
      rubricChecks: null,
    };
  }
  if (forceFinalize && !data.finalized) {
    return {
      ...data,
      finalized: true,
      nextQuestion: null,
      score: data.score ?? 0.5,
      feedback: data.feedback ?? "最終ターンの強制確定 (LLM が finalize 指示に従わなかったため)。",
    };
  }
  return data;
}

/** DesignResponse → 既存 grader 用の RubricCheckResult[] に寄せる */
export function designRubricChecks(r: DesignResponse): RubricCheckResult[] {
  return (r.rubricChecks ?? []).map((c) => ({
    id: c.id,
    passed: c.passed,
    comment: c.comment ?? "",
  }));
}
