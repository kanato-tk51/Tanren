import { describe, it, expect } from "vitest";

import { buildMcqPrompt, MCQ_PROMPT_VERSION } from "./prompts";

describe("buildMcqPrompt", () => {
  it("MCQ_PROMPT_VERSION は mcq.v1", () => {
    expect(MCQ_PROMPT_VERSION).toBe("mcq.v1");
  });

  it("固定の Output requirements が user の先頭に、可変の Concept/Spec 等が後ろに (prompt caching 前提)", () => {
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
    // user は固定 (Output requirements) が先、可変が後
    const outputIdx = out.user.indexOf("## Output requirements");
    const conceptIdx = out.user.indexOf("## Concept");
    const specIdx = out.user.indexOf("## Spec");
    const styleIdx = out.user.indexOf("## Style instruction");
    const avoidIdx = out.user.indexOf("## Avoid duplicates");
    expect(outputIdx).toBeGreaterThanOrEqual(0);
    expect(outputIdx).toBeLessThan(conceptIdx);
    expect(conceptIdx).toBeLessThan(specIdx);
    expect(specIdx).toBeLessThan(styleIdx);
    expect(styleIdx).toBeLessThan(avoidIdx);
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
        "user": "## Output requirements (固定)

      - \`prompt\` (string): 日本語の問題文
      - \`answer\` (string): 正解の 1 文 (他の distractors と区別できる決定的な選択肢)
      - \`distractors\` (string[]): 不正解候補を 3 つ。正解と紛らわしいが明らかに誤り
      - \`explanation\` (string): なぜ answer が正しく、distractors が誤りかを簡潔に日本語で説明
      - \`hint\` (string | null): 解答前に 1 回だけ表示できる軽いヒント (Optional)
      - \`tags\` (string[]): 1〜4 個の短い英語タグ (domain.subdomain を含めない)

      ## Concept (可変)

      id: programming.async.event_loop
      name: イベントループ
      description: JavaScript/Node.js のタスクキューとマイクロタスクの実行順
      domain: programming
      subdomain: async

      ## Spec (可変)

      difficulty: junior
      thinking_style: why

      ## Style instruction (可変)

      問題は「なぜそうなっているか」「理由を説明せよ」形式。表面的な定義を問わないこと。

      ## Avoid duplicates (可変)

      Past recent framings for this concept (last 30 days, if any):
      - setTimeout の評価タイミングを問う問題

      ## User misconceptions to correct (可変、任意)

      (none)",
      }
    `);
  });

  it("userMisconceptions があると矯正指示が user セクションに注入される (issue #19)", () => {
    const out = buildMcqPrompt({
      concept: {
        id: "network.tls.key_exchange",
        name: "TLS 鍵交換",
        description: null,
        domainId: "network",
        subdomainId: "tls",
      },
      difficulty: "mid",
      thinkingStyle: "why",
      pastQuestionsSummary: [],
      userMisconceptions: [
        { description: "tls 1.3 の鍵交換は rsa と誤解", count: 4 },
        { description: "rsa 鍵交換はおすすめ", count: 2 },
      ],
    });
    expect(out.user).toContain("## User misconceptions to correct");
    expect(out.user).toContain('"tls 1.3 の鍵交換は rsa と誤解" (seen 4 times');
    expect(out.user).toContain('"rsa 鍵交換はおすすめ" (seen 2 times');
    // misconceptions セクションに (none) が出ないことの確認 (concept description null の
    // "description: (none)" は別セクションなので除外)
    const misconceptionsSection = out.user.slice(
      out.user.indexOf("## User misconceptions to correct"),
    );
    expect(misconceptionsSection).not.toContain("(none)");
  });
});
