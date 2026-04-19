import { beforeEach, describe, expect, it, vi } from "vitest";

// mock chain: .from → .where → .groupBy → then (for query #2) or
//             .from → then (for query #1 concepts)
const queue: Array<() => unknown> = [];
vi.mock("@/db/client", () => {
  function makeBuilder(): unknown {
    const b: Record<string, unknown> = {
      from: () => b,
      where: () => b,
      groupBy: () => b,
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
  it("concept 0 件なら空配列 (DB 2 回目 query は呼ばれない)", async () => {
    queue.push(() => []);
    const out = await findDeficitCombos();
    expect(out).toEqual([]);
  });

  it("cache 不足の combo のみ返し、不足量降順 + conceptId 昇順", async () => {
    // query #1: concepts
    queue.push(() => [
      { id: "a", difficultyLevels: ["junior"] },
      { id: "b", difficultyLevels: ["junior"] },
    ]);
    // query #2: GROUP BY での count 集計 (見つかった combo のみ返す、無い combo は counts=0 扱い)
    queue.push(() => [
      // a/junior/why は 5 件で充足
      {
        conceptId: "a",
        difficulty: "junior",
        thinkingStyle: "why",
        cnt: PREBATCH_TARGET_PER_COMBO,
      },
      // a/junior/trade_off は 3 件 → 不足 2
      { conceptId: "a", difficulty: "junior", thinkingStyle: "trade_off", cnt: 3 },
      // b/junior/why は 1 件 → 不足 4
      { conceptId: "b", difficulty: "junior", thinkingStyle: "why", cnt: 1 },
      // b/junior/how は 15 件で充足超え
      { conceptId: "b", difficulty: "junior", thinkingStyle: "how", cnt: 15 },
      // a/junior/how, b/junior/trade_off は count が返っていない = 0 件扱い (不足 5)
    ]);

    const out = await findDeficitCombos();
    // 不足量降順: 5, 5, 4, 2
    // 同値 (5) は conceptId 昇順 → a/how, b/trade_off
    expect(out.map((c) => `${c.conceptId}|${c.thinkingStyle}`)).toEqual([
      "a|how",
      "b|trade_off",
      "b|why",
      "a|trade_off",
    ]);
  });

  it("全 combo が target 以上なら空配列", async () => {
    queue.push(() => [{ id: "a", difficultyLevels: ["junior"] }]);
    queue.push(() => [
      {
        conceptId: "a",
        difficulty: "junior",
        thinkingStyle: "why",
        cnt: PREBATCH_TARGET_PER_COMBO,
      },
      {
        conceptId: "a",
        difficulty: "junior",
        thinkingStyle: "how",
        cnt: PREBATCH_TARGET_PER_COMBO + 1,
      },
      {
        conceptId: "a",
        difficulty: "junior",
        thinkingStyle: "trade_off",
        cnt: PREBATCH_TARGET_PER_COMBO,
      },
    ]);
    const out = await findDeficitCombos();
    expect(out).toEqual([]);
  });
});
