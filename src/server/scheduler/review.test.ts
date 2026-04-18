import { beforeEach, describe, expect, it, vi } from "vitest";

import { REVIEW_MAX_COUNT, selectReviewCandidates } from "./review";

const queue: Array<() => unknown> = [];
const whereSpy = vi.fn();
const limitSpy = vi.fn();
const groupBySpy = vi.fn();
vi.mock("@/db/client", () => {
  function makeBuilder(): unknown {
    const b: Record<string, unknown> = {
      from: () => b,
      where: (...args: unknown[]) => {
        whereSpy(...args);
        return b;
      },
      orderBy: () => b,
      groupBy: (...args: unknown[]) => {
        groupBySpy(...args);
        return b;
      },
      limit: (...args: unknown[]) => {
        limitSpy(...args);
        return b;
      },
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
  whereSpy.mockClear();
  limitSpy.mockClear();
  groupBySpy.mockClear();
});

describe("selectReviewCandidates", () => {
  it("誤答 0 件なら空配列", async () => {
    queue.push(() => []); // wrong rows
    const out = await selectReviewCandidates({ userId: "u-1" });
    expect(out).toEqual([]);
  });

  it("GROUP BY 集約結果を latest 降順で返し、concept をマージする", async () => {
    // DB 側で集約済みの結果 (concept 別の max(createdAt))
    queue.push(() => [
      { conceptId: "c1", latest: new Date("2026-04-18T10:00:00Z") },
      { conceptId: "c2", latest: new Date("2026-04-18T09:00:00Z") },
      { conceptId: "c3", latest: new Date("2026-04-18T07:00:00Z") },
    ]);
    queue.push(() => [
      { id: "c1", name: "C1", domainId: "x", subdomainId: "y", prereqs: [] },
      { id: "c2", name: "C2", domainId: "x", subdomainId: "y", prereqs: [] },
      { id: "c3", name: "C3", domainId: "x", subdomainId: "y", prereqs: [] },
    ]);
    const out = await selectReviewCandidates({ userId: "u-1", count: 5 });
    expect(out.map((c) => c.concept.id)).toEqual(["c1", "c2", "c3"]);
    expect(out[0]!.latestWrongAt.toISOString()).toBe("2026-04-18T10:00:00.000Z");
  });

  it("同一 concept に偏っていても GROUP BY で 1 件に集約される (Round 1 指摘 #2 回帰)", async () => {
    // 極端なケース: c1 しか誤答がなく、以前は count*4 ヒューリスティックで 1 件しか
    // 取れなかった。GROUP BY ベースでは 1 件だが取りこぼしではなく「本当に 1 件」と一致。
    queue.push(() => [{ conceptId: "c1", latest: new Date("2026-04-18T10:00:00Z") }]);
    queue.push(() => [{ id: "c1", name: "C1", domainId: "x", subdomainId: "y", prereqs: [] }]);
    const out = await selectReviewCandidates({ userId: "u-1", count: 10 });
    expect(out).toHaveLength(1);
  });

  it("count は REVIEW_MAX_COUNT (15) で clamp", async () => {
    const rows = Array.from({ length: 30 }).map((_, i) => ({
      conceptId: `c-${i}`,
      latest: new Date(Date.UTC(2026, 3, 18, 0, 0, 30 - i)),
    }));
    // SQL 側で count でも絞るが、mock では呼び出し側の count 引数に従って slice される想定
    queue.push(() => rows.slice(0, REVIEW_MAX_COUNT));
    queue.push(() =>
      Array.from({ length: 30 }).map((_, i) => ({
        id: `c-${i}`,
        name: `C-${i}`,
        domainId: "x",
        subdomainId: "y",
        prereqs: [],
      })),
    );
    const out = await selectReviewCandidates({ userId: "u-1", count: 999 });
    expect(out.length).toBe(REVIEW_MAX_COUNT);
  });

  it("SQL ビルダ: where/groupBy/limit が必要な引数で呼ばれる", async () => {
    queue.push(() => []);
    const now = new Date("2026-04-18T00:00:00Z");
    await selectReviewCandidates({ userId: "u-42", count: 7, days: 14, now });

    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(groupBySpy).toHaveBeenCalledTimes(1);
    expect(limitSpy).toHaveBeenCalledTimes(1);
    // limit(count=7) を verify
    expect(limitSpy.mock.calls[0]?.[0]).toBe(7);

    // where の第 1 引数は drizzle SQL 式オブジェクト (queryChunks を持つ)
    const whereArg = whereSpy.mock.calls[0]?.[0] as { queryChunks?: unknown };
    expect(whereArg).toBeDefined();
    expect(whereArg.queryChunks).toBeDefined();

    // groupBy(attempts.conceptId) の第 1 引数は drizzle column の PgColumn オブジェクト。
    // column.name === 'concept_id' を検査して SQL フィールド名を固定。
    const groupArg = groupBySpy.mock.calls[0]?.[0] as { name?: string };
    expect(groupArg).toBeDefined();
    expect(groupArg.name).toBe("concept_id");
  });

  it("max(timestamp) が string で返ってきても Date に正規化される (driver 差異対策)", async () => {
    queue.push(() => [{ conceptId: "c1", latest: "2026-04-18T10:00:00.000Z" }]);
    queue.push(() => [{ id: "c1", name: "C1", domainId: "x", subdomainId: "y", prereqs: [] }]);
    const out = await selectReviewCandidates({ userId: "u-1" });
    expect(out[0]!.latestWrongAt).toBeInstanceOf(Date);
    expect(out[0]!.latestWrongAt.toISOString()).toBe("2026-04-18T10:00:00.000Z");
  });
});
