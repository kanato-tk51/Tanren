import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchHistory } from "./history";

// DB クライアントをクエリ順序で stub する。history.ts の呼び出し順序:
//   1. (domains 指定時) select({id}).from(concepts).where(inArray) → conceptIds
//   2. select(...).from(attempts).innerJoin.innerJoin.where.orderBy.limit → attempts rows
// drizzle chain を簡略化した promise-then stub。
// spy: where / orderBy に渡された式を capture して後段 assert できるようにする。
const queue: Array<() => unknown> = [];
const whereSpy = vi.fn();
const orderBySpy = vi.fn();
vi.mock("@/db/client", () => {
  function makeBuilder(): unknown {
    const b: Record<string, unknown> = {
      from: () => b,
      where: (...args: unknown[]) => {
        whereSpy(...args);
        return b;
      },
      orderBy: (...args: unknown[]) => {
        orderBySpy(...args);
        return b;
      },
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
  orderBySpy.mockClear();
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

  it("limit+1 件返ったら nextCursor を複合キー形式で設定 (createdAt ISO | attemptId)", async () => {
    const rows = Array.from({ length: 21 }).map((_, i) =>
      mkRow({
        attemptId: `a-${i}`,
        createdAt: new Date(Date.UTC(2026, 3, 20 - Math.floor(i / 5), 0, 0, 0)),
      }),
    );
    queue.push(() => rows);
    const out = await fetchHistory({ userId: "u-1", filter: { limit: 20 } });
    expect(out.items).toHaveLength(20);
    const last = out.items[out.items.length - 1]!;
    expect(out.nextCursor).toBe(`${last.createdAt.toISOString()}|${last.attemptId}`);
  });

  it("cursor 複合キー形式を受け付け、ISO 単独の旧形式との後方互換も保つ", async () => {
    queue.push(() => [mkRow()]);
    const out1 = await fetchHistory({
      userId: "u-1",
      filter: { cursor: "2026-04-18T00:00:00.000Z|a-99" },
    });
    expect(out1.items).toHaveLength(1);

    queue.push(() => [mkRow()]);
    const out2 = await fetchHistory({
      userId: "u-1",
      filter: { cursor: "2026-04-18T00:00:00.000Z" },
    });
    expect(out2.items).toHaveLength(1);
  });

  it("orderBy は (createdAt DESC, attemptId DESC) の 2 引数で呼ばれる (Round 3 spy 検証)", async () => {
    queue.push(() => []);
    await fetchHistory({ userId: "u-1" });
    expect(orderBySpy).toHaveBeenCalledTimes(1);
    expect(orderBySpy.mock.calls[0]).toHaveLength(2);
  });

  it("where は必ず呼ばれて predicate が注入されている (user_id フィルタの回帰防止)", async () => {
    queue.push(() => []);
    await fetchHistory({ userId: "u-1" });
    expect(whereSpy).toHaveBeenCalled();
    const arg = whereSpy.mock.calls[0]?.[0];
    expect(arg).toBeDefined();
  });

  it("同一 createdAt が limit 境界をまたいでも取りこぼさない (Round 2 指摘)", async () => {
    // 3 件が同時刻 + 1 件が古い時刻。limit=2 で 1 ページ目 2 件、2 ページ目 2 件。
    const sameTime = new Date("2026-04-18T10:00:00Z");
    const older = new Date("2026-04-18T09:00:00Z");
    // 1 ページ目: (sameTime, a-3) / (sameTime, a-2) の 2 件 + 余剰 1 件 (sameTime, a-1)
    // limit=2 の場合 select は limit+1=3 件を返す
    queue.push(() => [
      mkRow({ attemptId: "a-3", createdAt: sameTime }),
      mkRow({ attemptId: "a-2", createdAt: sameTime }),
      mkRow({ attemptId: "a-1", createdAt: sameTime }),
    ]);
    const p1 = await fetchHistory({ userId: "u-1", filter: { limit: 2 } });
    expect(p1.items.map((i) => i.attemptId)).toEqual(["a-3", "a-2"]);
    expect(p1.nextCursor).toBe(`${sameTime.toISOString()}|a-2`);

    // 2 ページ目: cursor=(sameTime, a-2) 以降。a-1 が同秒残存、後は older の a-0
    queue.push(() => [
      mkRow({ attemptId: "a-1", createdAt: sameTime }),
      mkRow({ attemptId: "a-0", createdAt: older }),
    ]);
    const p2 = await fetchHistory({
      userId: "u-1",
      filter: { limit: 2, cursor: p1.nextCursor! },
    });
    // limit=2 で 2 件返るがそれが全件なので nextCursor=null
    expect(p2.items.map((i) => i.attemptId)).toEqual(["a-1", "a-0"]);
    expect(p2.nextCursor).toBeNull();
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
