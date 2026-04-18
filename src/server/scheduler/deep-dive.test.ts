import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickDeepDiveStep, selectDeepDiveQueue, topoSortByPrereqs } from "./deep-dive";

const queue: Array<() => unknown> = [];
vi.mock("@/db/client", () => {
  function makeBuilder(): unknown {
    const b: Record<string, unknown> = {
      from: () => b,
      where: () => b,
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

beforeEach(() => {
  queue.length = 0;
});

describe("topoSortByPrereqs", () => {
  it("prereqs のない concept は先頭、依存は後ろに積まれる", () => {
    const out = topoSortByPrereqs([
      { id: "b", prereqs: ["a"] },
      { id: "a", prereqs: [] },
      { id: "c", prereqs: ["a", "b"] },
    ]);
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("同レベル内は id 昇順で決定論", () => {
    const out = topoSortByPrereqs([
      { id: "z", prereqs: [] },
      { id: "a", prereqs: [] },
      { id: "m", prereqs: [] },
    ]);
    expect(out).toEqual(["a", "m", "z"]);
  });

  it("domain 外 prereq は無視して domain 内 graph を作る", () => {
    // "external.x" は今回の入力に存在しない concept: 外部依存扱いで無視される
    const out = topoSortByPrereqs([
      { id: "a", prereqs: ["external.x"] },
      { id: "b", prereqs: ["a"] },
    ]);
    expect(out).toEqual(["a", "b"]);
  });

  it("循環があれば残りを id 順で末尾に積む (MVP 安全網)", () => {
    // a <-> b の循環
    const out = topoSortByPrereqs([
      { id: "a", prereqs: ["b"] },
      { id: "b", prereqs: ["a"] },
      { id: "c", prereqs: [] },
    ]);
    expect(out[0]).toBe("c");
    // 残り 2 件は id 順で積まれる
    expect(out.slice(1).sort()).toEqual(["a", "b"]);
  });
});

describe("selectDeepDiveQueue", () => {
  it("concept 0 件なら空配列", async () => {
    queue.push(() => []);
    const out = await selectDeepDiveQueue({ domainId: "network", count: 10 });
    expect(out).toEqual([]);
  });

  it("topo 順 → 難易度昇順 → 足りなければ循環で count 件埋める", async () => {
    queue.push(() => [
      // 依存順: a -> b / a の difficulty = [junior], b = [junior, mid]
      { id: "b", prereqs: ["a"], difficultyLevels: ["mid", "junior"] },
      { id: "a", prereqs: [], difficultyLevels: ["junior"] },
    ]);
    const out = await selectDeepDiveQueue({ domainId: "network", count: 5 });
    // flatten は [(a,junior),(b,junior),(b,mid)] → 5 件は循環で [(a,junior),(b,junior),(b,mid),(a,junior),(b,junior)]
    expect(out).toEqual([
      { conceptId: "a", difficulty: "junior" },
      { conceptId: "b", difficulty: "junior" },
      { conceptId: "b", difficulty: "mid" },
      { conceptId: "a", difficulty: "junior" },
      { conceptId: "b", difficulty: "junior" },
    ]);
  });

  it("count が available より少ないと先頭 count 件で打ち切り", async () => {
    queue.push(() => [{ id: "a", prereqs: [], difficultyLevels: ["beginner", "junior", "mid"] }]);
    const out = await selectDeepDiveQueue({ domainId: "network", count: 2 });
    expect(out).toEqual([
      { conceptId: "a", difficulty: "beginner" },
      { conceptId: "a", difficulty: "junior" },
    ]);
  });
});

describe("pickDeepDiveStep", () => {
  it("空キューは null", () => {
    expect(pickDeepDiveStep([], 0)).toBeNull();
  });

  it("round-robin で questionCount % len", () => {
    const q = [
      { conceptId: "a", difficulty: "junior" as const },
      { conceptId: "b", difficulty: "mid" as const },
    ];
    expect(pickDeepDiveStep(q, 0)).toEqual(q[0]);
    expect(pickDeepDiveStep(q, 1)).toEqual(q[1]);
    expect(pickDeepDiveStep(q, 2)).toEqual(q[0]);
  });
});
