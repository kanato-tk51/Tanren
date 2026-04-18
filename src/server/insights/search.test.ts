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
      mkAttemptHit({ userAnswer: "race!!!", feedback: null }), // userAnswer マッチ
      mkAttemptHit({ attemptId: "a-2", userAnswer: null, feedback: "race!!!" }), // feedback
      mkAttemptHit({ attemptId: "a-3", userAnswer: null, feedback: null }), // question fallback
    ]);
    queue.push(() => []);

    const out = await fetchSearch({ userId: "u-1", q: "race" });
    expect(out.hits.map((h) => h.hitSource)).toEqual(["userAnswer", "feedback", "question"]);
  });

  it("SQL injection: ' OR 1=1 -- / ; DROP TABLE / -- コメントを含む q でも通常検索として処理 (受け入れ基準)", async () => {
    const payloads = [
      "' OR 1=1 --",
      "; DROP TABLE attempts --",
      "admin' --",
      "\\'%\\_",
      "' UNION SELECT * FROM users --",
    ];
    for (const payload of payloads) {
      queue.length = 0;
      queue.push(() => []); // attempts
      queue.push(() => []); // misconceptions
      // SQL injection が成功していたら DB がエラーを投げるか全件返るかだが、
      // drizzle の ilike/eq は prepared statement で bind するため、q は常に値として扱われ、
      // 文字列としてそのままパターンに組み込まれる。エラーなく完走することを確認する。
      await expect(fetchSearch({ userId: "u-1", q: payload })).resolves.toBeDefined();
    }
  });

  it("SQL injection: whereSpy に渡る式は literal 結合ではなく drizzle SQL オブジェクト", async () => {
    queue.push(() => []);
    queue.push(() => []);
    await fetchSearch({ userId: "u-1", q: "' OR 1=1 --" });
    // attempts と misconceptions で whereSpy が呼ばれ、引数はオブジェクト (非 string)
    expect(whereSpy).toHaveBeenCalledTimes(2);
    for (const call of whereSpy.mock.calls) {
      const arg = call[0];
      expect(arg).toBeDefined();
      expect(typeof arg).not.toBe("string"); // literal SQL 文字列ではない = bind 済み drizzle 式
    }
  });

  it("limit=50 のとき attempts+misconceptions マージ後も最大 50 件 (Round 1 指摘 #2)", async () => {
    const attemptsRows = Array.from({ length: 50 }).map((_, i) =>
      mkAttemptHit({ attemptId: `a-${i}`, createdAt: new Date(Date.UTC(2026, 3, 18, 0, i)) }),
    );
    const miscRows = Array.from({ length: 50 }).map((_, i) =>
      mkMiscHit({ id: `m-${i}`, lastSeen: new Date(Date.UTC(2026, 3, 17, 0, i)) }),
    );
    queue.push(() => attemptsRows);
    queue.push(() => miscRows);

    const out = await fetchSearch({ userId: "u-1", q: "race", limit: 50 });
    expect(out.hits.length).toBe(50);
  });

  it("英数クエリと CJK-only クエリで where チャンク長が異なる (tsvector 経路 opt-in、issue #30)", async () => {
    // drizzle SQL オブジェクトの内部表現に依存せず、チャンク量で 2 つの経路の差を検出する。
    // 英数クエリ: attempts 側 OR 3 本 (ilike x3) + tsvector 2 本 + misc 側 OR 1 + tsvector 1
    // CJK-only:  attempts 側 OR 3 本 + misc 側 ILIKE 1 本のみ
    const chunkLen = (arg: unknown): number => {
      let total = 0;
      const walk = (x: unknown): void => {
        if (x == null) return;
        if (Array.isArray(x)) {
          for (const y of x) walk(y);
          return;
        }
        if (typeof x === "object" && "queryChunks" in (x as object)) {
          total += 1;
          walk((x as { queryChunks: unknown }).queryChunks);
        }
      };
      walk(arg);
      return total;
    };

    queue.push(() => []);
    queue.push(() => []);
    await fetchSearch({ userId: "u-1", q: "race condition" });
    const asciiLen = whereSpy.mock.calls.reduce((a, c) => a + chunkLen(c[0]), 0);

    whereSpy.mockClear();
    queue.push(() => []);
    queue.push(() => []);
    await fetchSearch({ userId: "u-1", q: "並行性" });
    const cjkLen = whereSpy.mock.calls.reduce((a, c) => a + chunkLen(c[0]), 0);

    // ASCII 経路は tsvector 分が増えるので CJK-only より多いはず
    expect(asciiLen).toBeGreaterThan(cjkLen);
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
