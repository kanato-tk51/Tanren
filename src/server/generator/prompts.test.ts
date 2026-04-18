import { describe, it, expect } from "vitest";

import { buildMcqPrompt, MCQ_PROMPT_VERSION } from "./prompts";

describe("buildMcqPrompt", () => {
  it("MCQ_PROMPT_VERSION は mcq.v1", () => {
    expect(MCQ_PROMPT_VERSION).toBe("mcq.v1");
  });

  it("共通 prefix が先頭にあり、variant が後ろに回っている (prompt caching 前提)", () => {
    const out = buildMcqPrompt({
      concept: {
        id: "network.http.methods_idempotency",
        name: "HTTP メソッドとベキ等性",
        description: "GET/POST/PUT/DELETE/PATCH の意味と安全性・冪等性",
        domainId: "network",
        subdomainId: "http",
      },
      difficulty: "junior",
      thinkingStyle: "why",
      pastQuestionsSummary: [],
    });

    // system は固定、先頭に配置
    expect(out.system.startsWith("You are a senior engineer")).toBe(true);
    // user は変動する concept セクションが下に来る形
    expect(out.user.indexOf("## Concept")).toBeLessThan(out.user.indexOf("## Spec"));
    expect(out.user.indexOf("## Spec")).toBeLessThan(out.user.indexOf("## Style instruction"));
    expect(out.user.indexOf("## Style instruction")).toBeLessThan(
      out.user.indexOf("## Avoid duplicates"),
    );
  });

  it("snapshot: 代表入力に対する組み立て結果", () => {
    const out = buildMcqPrompt({
      concept: {
        id: "programming.async.event_loop",
        name: "イベントループ",
        description: "JavaScript/Node.js のタスクキューとマイクロタスクの実行順",
        domainId: "programming",
        subdomainId: "async",
      },
      difficulty: "junior",
      thinkingStyle: "why",
      pastQuestionsSummary: ["setTimeout の評価タイミングを問う問題"],
    });

    // 代表入出力スナップショット (人間レビュー対象)
    expect({ system: out.system, user: out.user }).toMatchInlineSnapshot(`
      {
        "system": "You are a senior engineer creating a multiple-choice quiz question for a professional software engineer.
      Output strictly as JSON matching the provided schema. Use 日本語 (Japanese) for all human-readable fields.",
        "user": "## Concept

      id: programming.async.event_loop
      name: イベントループ
      description: JavaScript/Node.js のタスクキューとマイクロタスクの実行順
      domain: programming
      subdomain: async

      ## Spec

      difficulty: junior
      thinking_style: why

      ## Style instruction

      問題は「なぜそうなっているか」「理由を説明せよ」形式。表面的な定義を問わないこと。

      ## Avoid duplicates

      Past recent framings for this concept (last 30 days, if any):
      - setTimeout の評価タイミングを問う問題

      ## Output requirements

      - \`prompt\` (string): 日本語の問題文
      - \`answer\` (string): 正解の 1 文 (他の distractors と区別できる決定的な選択肢)
      - \`distractors\` (string[]): 不正解候補を 3 つ。正解と紛らわしいが明らかに誤り
      - \`explanation\` (string): なぜ answer が正しく、distractors が誤りかを簡潔に日本語で説明
      - \`hint\` (string | null): 解答前に 1 回だけ表示できる軽いヒント (Optional)
      - \`tags\` (string[]): 1〜4 個の短い英語タグ (domain.subdomain を含めない)",
      }
    `);
  });
});
