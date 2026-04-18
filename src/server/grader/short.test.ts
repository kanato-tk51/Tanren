import { describe, it, expect } from "vitest";

import { buildShortGradingPrompt } from "./prompts";
import { GradedShortSchema, SHORT_JSON_SCHEMA } from "./schema";

describe("buildShortGradingPrompt", () => {
  it("snapshot: 代表入力 (rubric あり) に対する組み立て結果", () => {
    const out = buildShortGradingPrompt({
      question: {
        prompt: "HTTP PUT と PATCH の違いを 1 文で。",
        answer: "PUT は冪等、PATCH は部分更新。",
        rubric: [
          { id: "r1", description: "PUT の冪等性に言及" },
          { id: "r2", description: "PATCH の部分更新に言及" },
        ],
      },
      userAnswer: "PUT は毎回同じ結果、PATCH は一部だけ変える。",
    });

    // Output requirements は冒頭 (prompt caching)
    expect(out.user.indexOf("## Output requirements")).toBeLessThan(
      out.user.indexOf("## Question"),
    );
    expect(out.user).toContain("id=r1");
    expect(out.user).toContain("PUT は毎回同じ結果");
  });

  it("rubric 未指定でも通る (fallback 文言)", () => {
    const out = buildShortGradingPrompt({
      question: {
        prompt: "x?",
        answer: "y",
        rubric: null,
      },
      userAnswer: "z",
    });
    expect(out.user).toContain("採点ルーブリックなし");
  });
});

describe("GradedShortSchema", () => {
  it("score 0.8 / correct true / feedback / rubricChecks の正常系", () => {
    const ok = {
      score: 0.8,
      correct: true,
      feedback: "概ね合格",
      rubricChecks: [{ id: "r1", passed: true, comment: "ok" }],
    };
    expect(() => GradedShortSchema.parse(ok)).not.toThrow();
  });

  it("score > 1 は reject", () => {
    const bad = { score: 1.2, correct: true, feedback: "x", rubricChecks: [] };
    expect(() => GradedShortSchema.parse(bad)).toThrow();
  });

  it("SHORT_JSON_SCHEMA は strict + additionalProperties:false", () => {
    expect(SHORT_JSON_SCHEMA.strict).toBe(true);
    expect(SHORT_JSON_SCHEMA.schema.additionalProperties).toBe(false);
  });
});
