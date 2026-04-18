import { beforeEach, describe, expect, it, vi } from "vitest";

import { REVIEW_MAX_COUNT, selectReviewCandidates } from "./review";

const queue: Array<() => unknown> = [];
vi.mock("@/db/client", () => {
  function makeBuilder(): unknown {
    const b: Record<string, unknown> = {
      from: () => b,
      where: () => b,
      orderBy: () => b,
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

beforeEach(() => {
  queue.length = 0;
});

describe("selectReviewCandidates", () => {
  it("誤答 0 件なら空配列", async () => {
    queue.push(() => []); // wrong rows
    const out = await selectReviewCandidates({ userId: "u-1" });
    expect(out).toEqual([]);
  });

  it("concept 別に最新誤答 1 件ずつに dedupe され、count 上限以内", async () => {
    // c1 が 3 回、c2 が 2 回、c3 が 1 回誤答 (時刻降順)
    queue.push(() => [
      { conceptId: "c1", createdAt: new Date("2026-04-18T10:00:00Z") },
      { conceptId: "c2", createdAt: new Date("2026-04-18T09:00:00Z") },
      { conceptId: "c1", createdAt: new Date("2026-04-18T08:00:00Z") },
      { conceptId: "c3", createdAt: new Date("2026-04-18T07:00:00Z") },
      { conceptId: "c1", createdAt: new Date("2026-04-18T06:00:00Z") },
      { conceptId: "c2", createdAt: new Date("2026-04-18T05:00:00Z") },
    ]);
    // 2 つ目の select は concepts 一覧
    queue.push(() => [
      { id: "c1", name: "C1", domainId: "x", subdomainId: "y", prereqs: [] },
      { id: "c2", name: "C2", domainId: "x", subdomainId: "y", prereqs: [] },
      { id: "c3", name: "C3", domainId: "x", subdomainId: "y", prereqs: [] },
    ]);
    const out = await selectReviewCandidates({ userId: "u-1", count: 5 });
    // c1 / c2 / c3 の 3 件、latestWrongAt が最新の誤答時刻
    expect(out.map((c) => c.concept.id)).toEqual(["c1", "c2", "c3"]);
    expect(out[0]!.latestWrongAt.toISOString()).toBe("2026-04-18T10:00:00.000Z");
  });

  it("count は REVIEW_MAX_COUNT (15) で clamp", async () => {
    const rows = Array.from({ length: 30 }).map((_, i) => ({
      conceptId: `c-${i}`,
      createdAt: new Date(Date.UTC(2026, 3, 18, 0, 0, 30 - i)),
    }));
    queue.push(() => rows);
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
});
