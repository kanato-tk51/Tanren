import { describe, it, expect, vi } from "vitest";

import { buildRebutPrompt, gradeRebut } from "./rebut";

const sampleInput = {
  question: {
    prompt: "HTTP PUT と PATCH の違いを 1 文で。",
    answer: "PUT は冪等、PATCH は部分更新。",
    rubric: [
      { id: "r1", description: "PUT の冪等性に言及" },
      { id: "r2", description: "PATCH の部分更新に言及" },
    ],
  },
  userAnswer: "PUT は同じリクエストを何度投げても状態が変わらない。PATCH は差分更新。",
  rebuttalMessage: "「状態が変わらない」は冪等性の言い換えです。これは正解のはず。",
  original: {
    correct: false,
    score: 0.5,
    feedback: "冪等性の明示が弱い",
  },
};

describe("buildRebutPrompt", () => {
  it("反論と元の採点を含む snapshot", () => {
    const out = buildRebutPrompt(sampleInput);
    expect({ system: out.system, user: out.user }).toMatchSnapshot();
  });

  it("Output requirements が user 冒頭 (prompt caching 規約)", () => {
    const out = buildRebutPrompt(sampleInput);
    expect(out.user.indexOf("## Output requirements")).toBeLessThan(
      out.user.indexOf("## Question"),
    );
    expect(out.user).toContain("## User's rebuttal");
    expect(out.user).toContain("## Original grading");
  });

  it("rubric 未指定でも通る (fallback 文言)", () => {
    const out = buildRebutPrompt({
      ...sampleInput,
      question: { ...sampleInput.question, rubric: null },
    });
    expect(out.user).toContain("採点ルーブリックなし");
  });

  it("original.correct null / score null でもフォーマットできる", () => {
    const out = buildRebutPrompt({
      ...sampleInput,
      original: { correct: null, score: null, feedback: null },
    });
    expect(out.user).toContain("判定: 未判定");
    expect(out.user).toContain("未評価");
  });
});

describe("gradeRebut", () => {
  it("score 0.8 → correct true を LLM 自己申告に関わらず導出", async () => {
    const llm = vi.fn().mockResolvedValue({
      score: 0.8,
      correct: false, // LLM が誤って false と言っても
      feedback: "反論妥当",
      rubricChecks: [],
    });
    const result = await gradeRebut(sampleInput, llm);
    expect(result.correct).toBe(true); // threshold で導出される
    expect(result.promptVersion).toBe("rebut.v1");
  });

  it("score 0.5 → correct false (反論棄却)", async () => {
    const llm = vi.fn().mockResolvedValue({
      score: 0.5,
      correct: true,
      feedback: "反論棄却",
      rubricChecks: [],
    });
    const result = await gradeRebut(sampleInput, llm);
    expect(result.correct).toBe(false);
  });
});
