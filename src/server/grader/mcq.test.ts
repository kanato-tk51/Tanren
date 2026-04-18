import { describe, it, expect } from "vitest";

import { gradeMcq } from "./mcq";

describe("gradeMcq", () => {
  const q = {
    answer: "PUT は冪等、PATCH は部分更新",
    distractors: ["PUT は body 不要", "PATCH はキャッシュされる", "両方とも冪等"],
  };

  it("正解と完全一致なら correct=true, score=1", () => {
    const r = gradeMcq(q, "PUT は冪等、PATCH は部分更新");
    expect(r.correct).toBe(true);
    expect(r.score).toBe(1);
    expect(r.feedback).toBe("正解です");
  });

  it("前後の空白は trim して許容", () => {
    const r = gradeMcq(q, "  PUT は冪等、PATCH は部分更新  ");
    expect(r.correct).toBe(true);
    expect(r.score).toBe(1);
  });

  it("distractor そのまま選んだら不正解", () => {
    const r = gradeMcq(q, "PUT は body 不要");
    expect(r.correct).toBe(false);
    expect(r.score).toBe(0);
    expect(r.feedback).toContain("正解は");
  });

  it("空文字は不正解", () => {
    const r = gradeMcq(q, "");
    expect(r.correct).toBe(false);
    expect(r.score).toBe(0);
  });

  it("大文字/小文字の違いは別回答とみなす (日本語文章の意味差を誤検知しないため、完全一致)", () => {
    const q2 = { answer: "Good", distractors: ["Bad"] };
    const r = gradeMcq(q2, "good");
    expect(r.correct).toBe(false);
  });
});
