import { describe, expect, it } from "vitest";

import { toMasteryTier } from "./mastery-map";

describe("toMasteryTier", () => {
  it("attemptCount 0 は untouched (masteryPct に関わらず)", () => {
    expect(toMasteryTier({ masteryPct: 0, attemptCount: 0 })).toBe("untouched");
    expect(toMasteryTier({ masteryPct: 1, attemptCount: 0 })).toBe("untouched");
  });

  it("40% 未満は weak", () => {
    expect(toMasteryTier({ masteryPct: 0, attemptCount: 1 })).toBe("weak");
    expect(toMasteryTier({ masteryPct: 0.39, attemptCount: 3 })).toBe("weak");
  });

  it("40-80% は mid", () => {
    expect(toMasteryTier({ masteryPct: 0.4, attemptCount: 3 })).toBe("mid");
    expect(toMasteryTier({ masteryPct: 0.79, attemptCount: 3 })).toBe("mid");
  });

  it("80% 以上は mastered", () => {
    expect(toMasteryTier({ masteryPct: 0.8, attemptCount: 3 })).toBe("mastered");
    expect(toMasteryTier({ masteryPct: 1, attemptCount: 10 })).toBe("mastered");
  });
});
