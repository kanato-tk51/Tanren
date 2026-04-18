import { describe, it, expect } from "vitest";

import { buildCopyForLlm } from "./copy-for-llm";

describe("buildCopyForLlm", () => {
  const base = {
    question: {
      prompt: "HTTP PUT と PATCH の違いは?",
      answer: "PUT は冪等、PATCH は部分更新。",
      tags: ["http", "rest"],
      hint: null,
    },
    userAnswer: "PUT は全置換、PATCH は差分",
    grading: { correct: true, score: 0.85, feedback: "主旨は合っています" },
  };

  it("すべてのセクションを含む snapshot", () => {
    expect(buildCopyForLlm(base)).toMatchSnapshot();
  });

  it("hint が null のときは # ヒントセクションを出さない", () => {
    const out = buildCopyForLlm(base);
    expect(out).not.toContain("# ヒント");
  });

  it("hint があるとヒントセクションを出す", () => {
    const out = buildCopyForLlm({
      ...base,
      question: { ...base.question, hint: "動詞の意味から考える" },
    });
    expect(out).toContain("# ヒント");
    expect(out).toContain("動詞の意味から考える");
  });

  it("tags が空なら # 分野を出さない", () => {
    const out = buildCopyForLlm({ ...base, question: { ...base.question, tags: [] } });
    expect(out).not.toContain("# 分野");
  });

  it("未回答 / 未評価の表示", () => {
    const out = buildCopyForLlm({
      ...base,
      userAnswer: "",
      grading: { correct: null, score: null, feedback: null },
    });
    expect(out).toContain("(未回答)");
    expect(out).toContain("判定: 未判定");
    expect(out).toContain("スコア: 未評価");
    // feedback が null のときは フィードバック行を出さない
    expect(out).not.toContain("- フィードバック:");
  });

  it("不正解のときは × 不正解 と表示", () => {
    const out = buildCopyForLlm({
      ...base,
      grading: { correct: false, score: 0.3, feedback: "逆です" },
    });
    expect(out).toContain("× 不正解");
    expect(out).toContain("スコア: 0.30");
  });
});
