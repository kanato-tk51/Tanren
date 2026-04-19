import { beforeEach, describe, expect, it, vi } from "vitest";

const queue: Array<() => unknown> = [];
vi.mock("@/db/client", () => {
  function makeBuilder(): unknown {
    const b: Record<string, unknown> = {
      from: () => b,
      where: () => b,
      limit: () => b,
      then: (onFulfilled: (v: unknown) => unknown) => {
        const handler = queue.shift();
        const result = handler ? handler() : [];
        return Promise.resolve(result).then(onFulfilled);
      },
    };
    return b;
  }
  return { getDb: () => ({ select: () => makeBuilder() }) };
});

import { findDeficitCombos, PREBATCH_TARGET_PER_COMBO } from "./pregenerate";

beforeEach(() => {
  queue.length = 0;
});

describe("findDeficitCombos", () => {
  it("concept 0 件なら空配列", async () => {
    queue.push(() => []);
    const out = await findDeficitCombos();
    expect(out).toEqual([]);
  });

  it("cache 不足の combo のみ返し、不足量降順 + 決定論順", async () => {
    // concept 2 個、各 difficulty 1 個 → combo は (2 concepts) × (1 diff) × (3 styles) = 6
    queue.push(() => [
      { id: "a", difficultyLevels: ["junior"] },
      { id: "b", difficultyLevels: ["junior"] },
    ]);
    // 各 combo の count query が順番に呼ばれる (6 combos × 1 query each)
    // 順番: a/junior/why, a/junior/how, a/junior/trade_off, b/junior/why, b/junior/how, b/junior/trade_off
    queue.push(() => [{ cnt: PREBATCH_TARGET_PER_COMBO }]); // a/why: OK (返さない)
    queue.push(() => [{ cnt: 0 }]); // a/how: 不足量 5
    queue.push(() => [{ cnt: 3 }]); // a/trade_off: 不足量 2
    queue.push(() => [{ cnt: 1 }]); // b/why: 不足量 4
    queue.push(() => [{ cnt: PREBATCH_TARGET_PER_COMBO + 10 }]); // b/how: OK
    queue.push(() => [{ cnt: 0 }]); // b/trade_off: 不足量 5

    const out = await findDeficitCombos();
    // 不足量降順: 5, 5, 4, 2
    // 同値 (5) は conceptId 昇順 → a/how が先、b/trade_off が次
    expect(out.map((c) => `${c.conceptId}|${c.thinkingStyle}`)).toEqual([
      "a|how",
      "b|trade_off",
      "b|why",
      "a|trade_off",
    ]);
  });

  it("全 combo が target 以上なら空配列", async () => {
    queue.push(() => [{ id: "a", difficultyLevels: ["junior"] }]);
    // 3 styles 全て充足
    queue.push(() => [{ cnt: PREBATCH_TARGET_PER_COMBO }]);
    queue.push(() => [{ cnt: PREBATCH_TARGET_PER_COMBO + 1 }]);
    queue.push(() => [{ cnt: PREBATCH_TARGET_PER_COMBO }]);
    const out = await findDeficitCombos();
    expect(out).toEqual([]);
  });
});
