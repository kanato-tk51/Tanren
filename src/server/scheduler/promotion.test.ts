import { describe, it, expect } from "vitest";

import { computePromotion, nextAllowedDifficulty } from "./promotion";

describe("nextAllowedDifficulty", () => {
  const concept = { difficultyLevels: ["beginner", "junior", "mid"] as const };

  it("junior → mid に昇格", () => {
    expect(
      nextAllowedDifficulty({ difficultyLevels: [...concept.difficultyLevels] }, "junior"),
    ).toBe("mid");
  });

  it("mid は daily cap に達しているので null", () => {
    expect(nextAllowedDifficulty({ difficultyLevels: [...concept.difficultyLevels] }, "mid")).toBe(
      null,
    );
  });

  it("concept が許可していない難易度はスキップ", () => {
    const sparse = { difficultyLevels: ["beginner", "mid"] as const };
    expect(
      nextAllowedDifficulty({ difficultyLevels: [...sparse.difficultyLevels] }, "beginner"),
    ).toBe("mid");
  });
});

describe("computePromotion", () => {
  const concept = { difficultyLevels: ["beginner", "junior", "mid", "senior"] as const };

  it("3 連続正解 (新しい順) で 1 段昇格", () => {
    const r = computePromotion({
      concept: { difficultyLevels: [...concept.difficultyLevels] },
      currentDifficulty: "junior",
      recentCorrect: [true, true, true],
    });
    expect(r).toBe("mid");
  });

  it("2 連続だけなら null", () => {
    const r = computePromotion({
      concept: { difficultyLevels: [...concept.difficultyLevels] },
      currentDifficulty: "junior",
      recentCorrect: [true, true],
    });
    expect(r).toBe(null);
  });

  it("直近 3 件に 1 つでも不正解が混ざれば null", () => {
    const r = computePromotion({
      concept: { difficultyLevels: [...concept.difficultyLevels] },
      currentDifficulty: "junior",
      recentCorrect: [true, false, true],
    });
    expect(r).toBe(null);
  });

  it("Daily cap (mid) を超えて senior にはならない", () => {
    const r = computePromotion({
      concept: { difficultyLevels: [...concept.difficultyLevels] },
      currentDifficulty: "mid",
      recentCorrect: [true, true, true],
    });
    expect(r).toBe(null);
  });
});
