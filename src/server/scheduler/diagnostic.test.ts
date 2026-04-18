import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickDiagnosticConcept, selectDiagnosticConcepts } from "./diagnostic";

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

describe("selectDiagnosticConcepts", () => {
  it("interestDomains が空なら早期 return で空配列 (DB を叩かない)", async () => {
    const out = await selectDiagnosticConcepts({
      interestDomains: [],
      selfLevel: "junior",
      count: 10,
    });
    expect(out).toEqual([]);
  });

  it("self_level に合致する concept が 0 件なら空配列", async () => {
    queue.push(() => [
      { id: "p1", domainId: "programming", difficultyLevels: ["senior"] },
      { id: "n1", domainId: "network", difficultyLevels: ["staff"] },
    ]);
    const out = await selectDiagnosticConcepts({
      interestDomains: ["programming", "network"],
      selfLevel: "junior",
      count: 5,
    });
    expect(out).toEqual([]);
  });

  it("domain ごとに round-robin、不足時は循環で重複出題", async () => {
    queue.push(() => [
      { id: "p1", domainId: "programming", difficultyLevels: ["junior"] },
      { id: "p2", domainId: "programming", difficultyLevels: ["junior"] },
      { id: "n1", domainId: "network", difficultyLevels: ["junior"] },
    ]);
    const out = await selectDiagnosticConcepts({
      interestDomains: ["programming", "network"],
      selfLevel: "junior",
      count: 5,
    });
    // round 0: [p1, n1] -> round 1: [p2, n1] -> round 2: [p1] (count=5 達成)
    expect(out).toEqual(["p1", "n1", "p2", "n1", "p1"]);
  });

  it("count が available より少ないと count 件で打ち切り", async () => {
    queue.push(() => [
      { id: "p1", domainId: "programming", difficultyLevels: ["junior"] },
      { id: "p2", domainId: "programming", difficultyLevels: ["junior"] },
      { id: "p3", domainId: "programming", difficultyLevels: ["junior"] },
    ]);
    const out = await selectDiagnosticConcepts({
      interestDomains: ["programming"],
      selfLevel: "junior",
      count: 2,
    });
    expect(out).toEqual(["p1", "p2"]);
  });
});

describe("pickDiagnosticConcept", () => {
  it("空キューは null", () => {
    expect(pickDiagnosticConcept([], 0)).toBeNull();
    expect(pickDiagnosticConcept([], 5)).toBeNull();
  });

  it("単一キューは常に同じ concept を返す", () => {
    expect(pickDiagnosticConcept(["a"], 0)).toBe("a");
    expect(pickDiagnosticConcept(["a"], 7)).toBe("a");
  });

  it("複数キューは round-robin で順番に返す", () => {
    const queue = ["a", "b", "c"];
    expect(pickDiagnosticConcept(queue, 0)).toBe("a");
    expect(pickDiagnosticConcept(queue, 1)).toBe("b");
    expect(pickDiagnosticConcept(queue, 2)).toBe("c");
    expect(pickDiagnosticConcept(queue, 3)).toBe("a");
    expect(pickDiagnosticConcept(queue, 4)).toBe("b");
  });
});
