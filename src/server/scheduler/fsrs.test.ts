import { describe, it, expect } from "vitest";

import { gradeMastery, Rating, scoreToRating } from "./fsrs";

describe("scoreToRating", () => {
  it("score で Easy/Good/Hard/Again を分岐", () => {
    expect(scoreToRating(1.0)).toBe(Rating.Easy);
    expect(scoreToRating(0.9)).toBe(Rating.Easy);
    expect(scoreToRating(0.85)).toBe(Rating.Good);
    expect(scoreToRating(0.7)).toBe(Rating.Good);
    expect(scoreToRating(0.6)).toBe(Rating.Hard);
    expect(scoreToRating(0.49)).toBe(Rating.Again);
    expect(scoreToRating(null)).toBe(Rating.Again);
  });
});

describe("gradeMastery", () => {
  it("初回 (current=null) でも next_review が未来になる", () => {
    const now = new Date("2026-04-18T00:00:00Z");
    const r = gradeMastery({ current: null, score: 0.8, at: now });
    expect(r.reviewCount).toBe(1);
    expect(r.lapseCount).toBe(0);
    expect(r.nextReview.getTime()).toBeGreaterThan(now.getTime());
  });

  it("Again のときは 10 分ルールで next_review が now+10min に収まる", () => {
    const now = new Date("2026-04-18T00:00:00Z");
    const r = gradeMastery({ current: null, score: 0.2, at: now });
    expect(r.lapseCount).toBe(1);
    expect(r.nextReview.getTime() - now.getTime()).toBeLessThanOrEqual(10 * 60 * 1000 + 1);
  });

  it("数日分のシミュレーションで next_review が日数単位で伸びる", () => {
    let state = gradeMastery({ current: null, score: 0.95, at: new Date("2026-04-18T00:00:00Z") });
    const day2 = new Date("2026-04-19T00:00:00Z");
    state = gradeMastery({
      current: {
        stability: state.stability,
        difficulty: state.difficulty,
        lastReview: state.lastReview,
        reviewCount: state.reviewCount,
        lapseCount: state.lapseCount,
        mastered: state.mastered,
        masteryPct: state.masteryPct,
      },
      score: 0.95,
      at: day2,
    });
    const day3 = new Date("2026-04-20T00:00:00Z");
    state = gradeMastery({
      current: {
        stability: state.stability,
        difficulty: state.difficulty,
        lastReview: state.lastReview,
        reviewCount: state.reviewCount,
        lapseCount: state.lapseCount,
        mastered: state.mastered,
        masteryPct: state.masteryPct,
      },
      score: 0.95,
      at: day3,
    });
    expect(state.reviewCount).toBe(3);
    expect(state.nextReview.getTime() - day3.getTime()).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it("15 回 review で masteryPct>=1 (上限 1.0)", () => {
    let state = gradeMastery({ current: null, score: 0.95, at: new Date("2026-04-18T00:00:00Z") });
    for (let i = 2; i <= 15; i++) {
      state = gradeMastery({
        current: {
          stability: state.stability,
          difficulty: state.difficulty,
          lastReview: state.lastReview,
          reviewCount: state.reviewCount,
          lapseCount: state.lapseCount,
          mastered: state.mastered,
          masteryPct: state.masteryPct,
        },
        score: 0.95,
        at: new Date(`2026-04-${18 + i}T00:00:00Z`),
      });
    }
    expect(state.masteryPct).toBe(1);
    expect(state.mastered).toBe(true);
  });
});
