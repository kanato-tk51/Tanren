import { describe, it, expect } from "vitest";

import { gradeShort } from "./short";

describe("gradeShort: correct は score から導出 (LLM 自己申告を信用しない)", () => {
  const input = {
    question: { prompt: "x", answer: "y", rubric: null },
    userAnswer: "z",
  };

  it("LLM が score 0.3 / correct true を返しても correct は false に矯正", async () => {
    const result = await gradeShort(input, async () => ({
      score: 0.3,
      correct: true,
      feedback: "矛盾する LLM 出力",
      rubricChecks: [],
    }));
    expect(result.correct).toBe(false);
    expect(result.score).toBe(0.3);
  });

  it("score 0.7 以上なら correct=true", async () => {
    const result = await gradeShort(input, async () => ({
      score: 0.8,
      correct: false,
      feedback: "x",
      rubricChecks: [],
    }));
    expect(result.correct).toBe(true);
  });

  it("境界値 0.7 は correct=true", async () => {
    const result = await gradeShort(input, async () => ({
      score: 0.7,
      correct: false,
      feedback: "x",
      rubricChecks: [],
    }));
    expect(result.correct).toBe(true);
  });
});
