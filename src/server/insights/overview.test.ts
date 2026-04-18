import { describe, expect, it, vi, beforeEach } from "vitest";

import { fetchInsightsOverview } from "./overview";

// DB クライアントをテーブル別に mock して集計ロジックだけを検証する。
// 各テストで __conceptRows / __masteryRows / __attemptCountRows / __recentRows を差し替える。
const fixtures: {
  concepts: unknown[];
  mastery: unknown[];
  attemptsGroup: unknown[];
  attemptsRecent: unknown[];
} = {
  concepts: [],
  mastery: [],
  attemptsGroup: [],
  attemptsRecent: [],
};

vi.mock("@/db/client", () => {
  // 呼び出し順序で返り値を切り替える: 1. select().from(concepts) → conceptRows
  // 2. select().from(mastery).where() → masteryRows
  // 3. select({conceptId, total}).from(attempts).where().groupBy() → attemptsGroup
  // 4. select({conceptId, correct}).from(attempts).where().orderBy().limit() → attemptsRecent
  let callIdx = 0;
  const queue = [
    () => fixtures.concepts,
    () => fixtures.mastery,
    () => fixtures.attemptsGroup,
    () => fixtures.attemptsRecent,
  ];
  // drizzle builder をイミュータブルに chain したい。テスト簡略化のため then を返す。
  function makeBuilder(): unknown {
    const b = {
      from: () => b,
      where: () => b,
      orderBy: () => b,
      groupBy: () => b,
      limit: () => b,
      then: (onFulfilled: (v: unknown) => unknown) => {
        const result = queue[callIdx++]?.() ?? [];
        return Promise.resolve(result).then(onFulfilled);
      },
    };
    return b;
  }
  return {
    getDb: () => ({
      select: () => makeBuilder(),
    }),
    __setFixtures: (f: typeof fixtures) => {
      Object.assign(fixtures, f);
      callIdx = 0;
    },
    __resetCall: () => {
      callIdx = 0;
    },
  };
});

beforeEach(async () => {
  const mod = (await import("@/db/client")) as unknown as { __resetCall: () => void };
  mod.__resetCall();
  fixtures.concepts = [];
  fixtures.mastery = [];
  fixtures.attemptsGroup = [];
  fixtures.attemptsRecent = [];
});

describe("fetchInsightsOverview (集計スナップショット)", () => {
  it("空データなら全部 0 / 空配列", async () => {
    const out = await fetchInsightsOverview("u-1");
    expect(out.totalConcepts).toBe(0);
    expect(out.masteredConcepts).toBe(0);
    expect(out.strongest).toEqual([]);
    expect(out.weakest).toEqual([]);
    expect(out.blindSpots).toEqual([]);
    expect(out.decaying).toEqual([]);
  });

  it("strongest は mastery 降順、attemptCount > 0 のみ", async () => {
    const now = new Date("2026-04-18T00:00:00Z");
    fixtures.concepts = [
      { id: "c1", name: "A", domainId: "x", subdomainId: "y", prereqs: [] },
      { id: "c2", name: "B", domainId: "x", subdomainId: "y", prereqs: [] },
      { id: "c3", name: "C", domainId: "x", subdomainId: "y", prereqs: [] },
      { id: "c4", name: "D", domainId: "x", subdomainId: "y", prereqs: [] },
    ];
    fixtures.mastery = [
      { conceptId: "c1", userId: "u-1", mastered: false, masteryPct: 0.9, lastReview: now },
      { conceptId: "c2", userId: "u-1", mastered: true, masteryPct: 0.95, lastReview: now },
      { conceptId: "c3", userId: "u-1", mastered: false, masteryPct: 0.3, lastReview: now },
      // c4 は attempt なし (attemptCount=0) なので strongest に入らない
      { conceptId: "c4", userId: "u-1", mastered: false, masteryPct: 1.0, lastReview: null },
    ];
    fixtures.attemptsGroup = [
      { conceptId: "c1", total: 10 },
      { conceptId: "c2", total: 8 },
      { conceptId: "c3", total: 12 },
    ];
    fixtures.attemptsRecent = [];
    const out = await fetchInsightsOverview("u-1");
    expect(out.strongest.map((s) => s.conceptId)).toEqual(["c2", "c1", "c3"]);
  });

  it("weakest は attempt>=5 かつ mastery<0.5 のみ、低い順", async () => {
    const now = new Date("2026-04-18T00:00:00Z");
    fixtures.concepts = [
      { id: "c1", name: "A", domainId: "x", subdomainId: "y", prereqs: [] },
      { id: "c2", name: "B", domainId: "x", subdomainId: "y", prereqs: [] },
      { id: "c3", name: "C", domainId: "x", subdomainId: "y", prereqs: [] },
    ];
    fixtures.mastery = [
      { conceptId: "c1", userId: "u-1", mastered: false, masteryPct: 0.4, lastReview: now },
      { conceptId: "c2", userId: "u-1", mastered: false, masteryPct: 0.2, lastReview: now },
      // c3 は attempt が 3 件なので weakest に入らない
      { conceptId: "c3", userId: "u-1", mastered: false, masteryPct: 0.1, lastReview: now },
    ];
    fixtures.attemptsGroup = [
      { conceptId: "c1", total: 6 },
      { conceptId: "c2", total: 8 },
      { conceptId: "c3", total: 3 },
    ];
    fixtures.attemptsRecent = [];
    const out = await fetchInsightsOverview("u-1");
    expect(out.weakest.map((w) => w.conceptId)).toEqual(["c2", "c1"]);
  });

  it("blindSpots は attempt=0 かつ prereqs 全 mastered の concept", async () => {
    fixtures.concepts = [
      { id: "c1", name: "A", domainId: "x", subdomainId: "y", prereqs: [] },
      { id: "c2", name: "B", domainId: "x", subdomainId: "y", prereqs: ["c1"] },
      { id: "c3", name: "C", domainId: "x", subdomainId: "y", prereqs: ["c2"] },
    ];
    fixtures.mastery = [
      { conceptId: "c1", userId: "u-1", mastered: true, masteryPct: 0.9, lastReview: new Date() },
    ];
    fixtures.attemptsGroup = [{ conceptId: "c1", total: 10 }];
    fixtures.attemptsRecent = [];
    const out = await fetchInsightsOverview("u-1");
    expect(out.blindSpots.map((b) => b.conceptId)).toEqual(["c2"]);
    // c3 は prereq (c2) が未 mastered なので入らない
    expect(out.blindSpots.find((b) => b.conceptId === "c3")).toBeUndefined();
  });

  it("decaying は lastReview が 7 日以上前 & mastery<0.8 & attempt>0", async () => {
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recent = new Date();
    fixtures.concepts = [
      { id: "old", name: "Old", domainId: "x", subdomainId: "y", prereqs: [] },
      { id: "fresh", name: "Fresh", domainId: "x", subdomainId: "y", prereqs: [] },
      { id: "no-review", name: "NoReview", domainId: "x", subdomainId: "y", prereqs: [] },
    ];
    fixtures.mastery = [
      { conceptId: "old", userId: "u-1", mastered: false, masteryPct: 0.5, lastReview: longAgo },
      { conceptId: "fresh", userId: "u-1", mastered: false, masteryPct: 0.5, lastReview: recent },
      { conceptId: "no-review", userId: "u-1", mastered: false, masteryPct: 0.5, lastReview: null },
    ];
    fixtures.attemptsGroup = [
      { conceptId: "old", total: 3 },
      { conceptId: "fresh", total: 3 },
      { conceptId: "no-review", total: 3 },
    ];
    fixtures.attemptsRecent = [];
    const out = await fetchInsightsOverview("u-1");
    expect(out.decaying.map((d) => d.conceptId)).toEqual(["old"]);
  });
});
