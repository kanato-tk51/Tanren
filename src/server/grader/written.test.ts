import { describe, it, expect } from "vitest";

import { buildWrittenGradingPrompt, gradeWritten } from "./written";

describe("buildWrittenGradingPrompt", () => {
  it("snapshot: 代表入力 (rubric あり)", () => {
    const out = buildWrittenGradingPrompt({
      question: {
        prompt: "TCP 輻輳制御の基本アルゴリズムを複数段落で説明。",
        answer: "Slow start / Congestion avoidance / Fast retransmit / Fast recovery の 4 段階。",
        rubric: [
          { id: "r1", description: "slow start に言及", weight: 0.25 },
          { id: "r2", description: "cwnd 増加の式に言及", weight: 0.25 },
          { id: "r3", description: "fast retransmit / fast recovery の違い", weight: 0.5 },
        ],
      },
      userAnswer:
        "TCP の輻輳制御は slow start で指数関数的に cwnd を増やし、閾値を超えたら AIMD で線形に増やす。3 ACK が来たら fast retransmit で再送する。",
    });
    expect({ system: out.system, user: out.user }).toMatchSnapshot();
  });
});

describe("gradeWritten: LLM の correct は score から導出する", () => {
  const question = {
    prompt: "説明せよ",
    answer: "模範回答",
    rubric: [{ id: "r1", description: "x", weight: 1 }],
  };

  it("score 0.6 は correct=false (部分点だが合格閾値 0.7 未満)", async () => {
    const r = await gradeWritten({ question, userAnswer: "xxx" }, async () => ({
      score: 0.6,
      correct: true, // LLM 自己申告は信用しない
      feedback: "x",
      rubricChecks: [],
    }));
    expect(r.correct).toBe(false);
  });

  it("score 0.8 は correct=true", async () => {
    const r = await gradeWritten({ question, userAnswer: "xxx" }, async () => ({
      score: 0.8,
      correct: false,
      feedback: "x",
      rubricChecks: [],
    }));
    expect(r.correct).toBe(true);
  });
});
