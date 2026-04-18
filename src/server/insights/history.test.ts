import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchHistory } from "./history";

// DB クライアントをクエリ順序で stub する。history.ts の呼び出し順序:
//   1. (domains 指定時) select({id}).from(concepts).where(inArray) → conceptIds
//   2. select(...).from(attempts).innerJoin.innerJoin.where.orderBy.limit → attempts rows
// drizzle chain を簡略化した promise-then stub。
const queue: Array<() => unknown> = [];
vi.mock("@/db/client", () => {
  function makeBuilder(): unknown {
    const b: Record<string, unknown> = {
      from: () => b,
      where: () => b,
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
});

function mkRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    attemptId: "a-1",
    createdAt: new Date("2026-04-18T00:00:00Z"),
    correct: true,
    score: 1,
    feedback: null,
    userAnswer: "ans",
    questionId: "q-1",
    questionPrompt: "Q?",
    questionAnswer: "A",
    questionType: "mcq",
    difficulty: "junior",
    conceptId: "c-1",
    conceptName: "C1",
    domainId: "network",
    subdomainId: "http",
    ...over,
  };
}

describe("fetchHistory", () => {
  it("空結果: nextCursor=null, items=[]", async () => {
    queue.push(() => []); // attempts 行
    const out = await fetchHistory({ userId: "u-1" });
    expect(out.items).toEqual([]);
    expect(out.nextCursor).toBeNull();
  });

  it("limit+1 件返ったら nextCursor を設定", async () => {
    const rows = Array.from({ length: 21 }).map((_, i) =>
      mkRow({
        attemptId: `a-${i}`,
        createdAt: new Date(Date.UTC(2026, 3, 20 - Math.floor(i / 5), 0, 0, 0)),
      }),
    );
    queue.push(() => rows);
    const out = await fetchHistory({ userId: "u-1", filter: { limit: 20 } });
    expect(out.items).toHaveLength(20);
    expect(out.nextCursor).toBe(out.items[out.items.length - 1]!.createdAt.toISOString());
  });

  it("limit に満たなければ nextCursor=null", async () => {
    queue.push(() => [mkRow()]);
    const out = await fetchHistory({ userId: "u-1", filter: { limit: 20 } });
    expect(out.items).toHaveLength(1);
    expect(out.nextCursor).toBeNull();
  });

  it("domains フィルタ: 対象 concept が 0 件ならすぐ空配列 (早期 return)", async () => {
    queue.push(() => []); // concepts where inArray 結果
    const out = await fetchHistory({
      userId: "u-1",
      filter: { domains: ["network"] },
    });
    expect(out.items).toEqual([]);
    expect(out.nextCursor).toBeNull();
  });

  it("domains フィルタ: concepts が返れば attempts を引く", async () => {
    queue.push(() => [{ id: "c-1" }]); // conceptIds
    queue.push(() => [mkRow()]); // attempts
    const out = await fetchHistory({
      userId: "u-1",
      filter: { domains: ["network"] },
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.domainId).toBe("network");
  });

  it("不正な cursor は無視 (例外にせず結果を返す)", async () => {
    queue.push(() => [mkRow()]);
    const out = await fetchHistory({
      userId: "u-1",
      filter: { cursor: "not-a-date" },
    });
    expect(out.items).toHaveLength(1);
  });
});
