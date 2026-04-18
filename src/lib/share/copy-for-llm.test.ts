import { describe, it, expect } from "vitest";

import { buildCopyForLlm } from "./copy-for-llm";

describe("buildCopyForLlm", () => {
  const base = {
    question: {
      prompt: "HTTP PUT と PATCH の違いは?",
      answer: "PUT は冪等、PATCH は部分更新。",
      tags: ["http", "rest"],
      hint: null,
      meta: {
        domain: "backend",
        subdomain: "http",
        conceptName: "PUT / PATCH",
        conceptId: "backend.http.put_patch",
        thinkingStyle: "concept",
        difficulty: "junior",
      },
    },
    userAnswer: "PUT は全置換、PATCH は差分",
    grading: {
      correct: true,
      score: 0.85,
      feedback: "主旨は合っています",
      rubricChecks: [{ id: "r1", passed: true, comment: "冪等性に言及" }],
    },
  };

  it("docs §7.13.4 準拠 テンプレ snapshot", () => {
    expect(buildCopyForLlm(base)).toMatchSnapshot();
  });

  it("冒頭が「私はエンジニア学習アプリ」で始まる", () => {
    expect(buildCopyForLlm(base).startsWith("私はエンジニア学習アプリ")).toBe(true);
  });

  it("hint が null のときは ## ヒントセクションを出さない", () => {
    const out = buildCopyForLlm(base);
    expect(out).not.toContain("## ヒント");
  });

  it("hint があると出す", () => {
    const out = buildCopyForLlm({
      ...base,
      question: { ...base.question, hint: "動詞の意味から考える" },
    });
    expect(out).toContain("## ヒント");
    expect(out).toContain("動詞の意味から考える");
  });

  it("meta が空でも落ちない / 関連行は出さない", () => {
    const out = buildCopyForLlm({
      ...base,
      question: { ...base.question, meta: null, tags: [] },
    });
    expect(out).not.toContain("- ドメイン:");
    expect(out).not.toContain("- 概念:");
    expect(out).not.toContain("- 思考スタイル:");
    expect(out).toContain("## 問題");
  });

  it("未回答 / 未評価の表示", () => {
    const out = buildCopyForLlm({
      ...base,
      userAnswer: "",
      grading: { correct: null, score: null, feedback: null, rubricChecks: [] },
    });
    expect(out).toContain("(未回答)");
    expect(out).toContain("- スコア: 未評価");
    expect(out).not.toContain("- 判定:");
    expect(out).not.toContain("- フィードバック:");
  });

  it("user answer が 2000 文字を超えたら ... で切る", () => {
    const long = "あ".repeat(2500);
    const out = buildCopyForLlm({ ...base, userAnswer: long });
    expect(out).toContain("...");
    expect(out).not.toContain("あ".repeat(2500));
  });

  it("バッククォート 3 連は ~~~ に置換 (貼り付け先でのコードブロック衝突回避)", () => {
    const out = buildCopyForLlm({
      ...base,
      userAnswer: "```ts\nconsole.log(1)\n```",
    });
    expect(out).not.toContain("```");
    expect(out).toContain("~~~");
  });

  it("meta / tags / rubricChecks.comment の改行・``` も sanitize される", () => {
    const out = buildCopyForLlm({
      ...base,
      question: {
        ...base.question,
        tags: ["tag\nwith\nnewline", "```danger"],
        meta: {
          ...base.question.meta,
          conceptName: "name\nwith\nbreak",
          conceptId: "id```inside",
        },
      },
      grading: {
        ...base.grading,
        rubricChecks: [{ id: "r1", passed: true, comment: "comment\nwith break ```" }],
      },
    });
    // メタ / タグ / rubric comment から ``` や改行が除去されている
    expect(out).not.toMatch(/```/);
    // タグ行が 1 行で閉じる
    const tagLine = out.split("\n").find((l) => l.startsWith("- タグ:"));
    expect(tagLine).toBeDefined();
    expect(tagLine).not.toContain("\n");
    // concept 行も 1 行
    const conceptLine = out.split("\n").find((l) => l.startsWith("- 概念:"));
    expect(conceptLine).not.toContain("\n");
  });
});
