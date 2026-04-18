import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSearch } from "./search";

// 2 クエリ (attempts 側 / misconceptions 側) 順に結果を返す stub。
const queue: Array<() => unknown> = [];
const whereSpy = vi.fn();
vi.mock("@/db/client", () => {
  function makeBuilder(): unknown {
    const b: Record<string, unknown> = {
      from: () => b,
      where: (...args: unknown[]) => {
        whereSpy(...args);
        return b;
      },
      orderBy: () => b,
      limit: () => b,
      innerJoin: () => b,
      then: (onFulfilled: (v: unknown) => unknown) => {
        const handler = queue.shift();
        const result = handler ? handler() : [];
        return Promise.resolve(result).then(onFulfilled);
      },
    };
    return b;
  }
  return {
    getDb: () => ({ select: () => makeBuilder() }),
  };
});

beforeEach(() => {
  queue.length = 0;
  whereSpy.mockClear();
});

function mkAttemptHit(over: Partial<Record<string, unknown>> = {}) {
  return {
    attemptId: "a-1",
    createdAt: new Date("2026-04-18T00:00:00Z"),
    userAnswer: "race condition を発見した",
    feedback: null,
    correct: true,
    score: 1,
    questionPrompt: "並行性とは?",
    conceptId: "c-1",
    conceptName: "並行性",
    domainId: "os",
    subdomainId: "concurrency",
    ua: "race condition を発見した",
    fb: null,
    qp: "並行性とは?",
    ...over,
  };
}

function mkMiscHit(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "m-1",
    description: "race condition は常に lock で解決できる",
    conceptId: "c-1",
    conceptName: "並行性",
    domainId: "os",
    subdomainId: "concurrency",
    lastSeen: new Date("2026-04-17T00:00:00Z"),
    ...over,
  };
}

describe("fetchSearch", () => {
  it("空クエリは即空配列 (DB 呼び出しなし)", async () => {
    const out = await fetchSearch({ userId: "u-1", q: "   " });
    expect(out.hits).toEqual([]);
    expect(out.domainHits).toEqual([]);
    expect(whereSpy).not.toHaveBeenCalled();
  });

  it("attempts と misconceptions の両方から hit を取得して時系列で集約", async () => {
    queue.push(() => [mkAttemptHit()]); // attempts
    queue.push(() => [mkMiscHit()]); // misconceptions

    const out = await fetchSearch({ userId: "u-1", q: "race" });
    expect(out.hits).toHaveLength(2);
    // createdAt 降順: a-1 (2026-04-18) → m-1 (2026-04-17)
    expect(out.hits[0]!.attemptId).toBe("a-1");
    expect(out.hits[1]!.attemptId).toBe("misc-m-1");
    expect(out.hits[1]!.hitSource).toBe("misconception");
  });

  it("hitSource は userAnswer > feedback > question の優先順で判定", async () => {
    queue.push(() => [
      mkAttemptHit({ ua: "race!!!", fb: null }), // userAnswer マッチ → "userAnswer"
      mkAttemptHit({
        attemptId: "a-2",
        ua: null,
        userAnswer: null,
        fb: "race!!!",
        feedback: "race!!!",
      }), // feedback マッチ
      mkAttemptHit({
        attemptId: "a-3",
        ua: null,
        userAnswer: null,
        fb: null,
        feedback: null,
      }), // question だけマッチ (fallback)
    ]);
    queue.push(() => []);

    const out = await fetchSearch({ userId: "u-1", q: "race" });
    expect(out.hits.map((h) => h.hitSource)).toEqual(["userAnswer", "feedback", "question"]);
  });

  it("domainHits: ドメインごとの件数を降順で集約", async () => {
    queue.push(() => [
      mkAttemptHit({ attemptId: "a-1", domainId: "os" }),
      mkAttemptHit({ attemptId: "a-2", domainId: "os" }),
      mkAttemptHit({ attemptId: "a-3", domainId: "network" }),
    ]);
    queue.push(() => []);

    const out = await fetchSearch({ userId: "u-1", q: "race" });
    expect(out.domainHits).toEqual([
      { domainId: "os", count: 2 },
      { domainId: "network", count: 1 },
    ]);
  });
});
