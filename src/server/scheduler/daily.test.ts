import { describe, it, expect } from "vitest";

import type { Concept, Mastery } from "@/db/schema";

import { priorityFor, rankDailyCandidates } from "./daily";

const now = new Date("2026-04-18T00:00:00Z");

function concept(
  id: string,
  prereqs: string[] = [],
  difficultyLevels: Concept["difficultyLevels"] = ["junior", "mid"],
): Concept {
  return {
    id,
    domainId: "network",
    subdomainId: "http",
    name: id,
    description: null,
    prereqs,
    tags: [],
    difficultyLevels,
    createdAt: now,
    updatedAt: now,
  };
}

function mastery(params: Partial<Mastery> & Pick<Mastery, "conceptId">): Mastery {
  return {
    userId: "u1",
    conceptId: params.conceptId,
    stability: params.stability ?? 0,
    difficulty: params.difficulty ?? 0,
    lastReview: params.lastReview ?? now,
    nextReview: params.nextReview ?? null,
    reviewCount: params.reviewCount ?? 1,
    lapseCount: params.lapseCount ?? 0,
    mastered: params.mastered ?? false,
    masteryPct: params.masteryPct ?? 0,
  };
}

describe("priorityFor", () => {
  it("due が深いほど高い", () => {
    const c = concept("c1");
    const oldDue = mastery({
      conceptId: "c1",
      nextReview: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
    });
    const recent = mastery({
      conceptId: "c1",
      nextReview: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
    });
    expect(priorityFor({ concept: c, mastery: oldDue, isBlindSpot: false, now })).toBeGreaterThan(
      priorityFor({ concept: c, mastery: recent, isBlindSpot: false, now }),
    );
  });

  it("lapse が多いほど高い", () => {
    const c = concept("c1");
    const many = mastery({ conceptId: "c1", lapseCount: 3 });
    const few = mastery({ conceptId: "c1", lapseCount: 0 });
    expect(priorityFor({ concept: c, mastery: many, isBlindSpot: false, now })).toBeGreaterThan(
      priorityFor({ concept: c, mastery: few, isBlindSpot: false, now }),
    );
  });

  it("masteryPct が高いほどペナルティで下がる", () => {
    const c = concept("c1");
    const high = mastery({ conceptId: "c1", masteryPct: 0.9 });
    const low = mastery({ conceptId: "c1", masteryPct: 0.1 });
    expect(priorityFor({ concept: c, mastery: high, isBlindSpot: false, now })).toBeLessThan(
      priorityFor({ concept: c, mastery: low, isBlindSpot: false, now }),
    );
  });

  it("blind_spot bonus で未着手が上位に", () => {
    const c = concept("c1");
    expect(priorityFor({ concept: c, mastery: null, isBlindSpot: true, now })).toBeGreaterThan(0);
  });
});

describe("rankDailyCandidates", () => {
  const a = concept("a");
  const b = concept("b", ["a"]);
  const c = concept("c", ["a"]);
  const d = concept("d", ["a", "c"]);

  it("due のみ、priority 順で返す", () => {
    const masteries = [
      mastery({ conceptId: "a", nextReview: new Date(now.getTime() - 3 * 864e5) }),
      mastery({ conceptId: "b", nextReview: new Date(now.getTime() - 1 * 864e5) }),
    ];
    const out = rankDailyCandidates({ concepts: [a, b, c, d], masteries, count: 5, now });
    // a (3 日 overdue) が b (1 日) より先。c / d は未着手 & prereqs (a) 未 mastered なので blind でない
    expect(out[0]?.concept.id).toBe("a");
    expect(out[1]?.concept.id).toBe("b");
    expect(out.some((x) => x.reason === "blind_spot")).toBe(false);
  });

  it("prereqs を全て mastered なら blind_spot 追加 (最大 2)", () => {
    const masteries = [mastery({ conceptId: "a", mastered: true, nextReview: null })];
    // a mastered → b と c は blind。d は a+c の片方 (c) 未 mastered なので除外
    const out = rankDailyCandidates({ concepts: [a, b, c, d], masteries, count: 5, now });
    const blind = out.filter((x) => x.reason === "blind_spot").map((x) => x.concept.id);
    expect(blind.sort()).toEqual(["b", "c"]);
    expect(blind).not.toContain("d");
  });

  it("blind_spot は最大 2 件に制限", () => {
    const masteries = [mastery({ conceptId: "a", mastered: true })];
    // b, c, d は prereqs を満たすもの / 満たさないものがあるが、仮に全て prereqs=['a'] だと 3 件すべて blind
    const b2 = concept("b", ["a"]);
    const c2 = concept("c", ["a"]);
    const d2 = concept("d", ["a"]);
    const out = rankDailyCandidates({ concepts: [a, b2, c2, d2], masteries, count: 5, now });
    const blind = out.filter((x) => x.reason === "blind_spot");
    expect(blind.length).toBeLessThanOrEqual(2);
  });

  it("snapshot: 代表ケース", () => {
    const masteries = [
      mastery({
        conceptId: "a",
        mastered: true,
        masteryPct: 0.9,
        nextReview: new Date(now.getTime() - 0.5 * 864e5),
      }),
      mastery({
        conceptId: "b",
        nextReview: new Date(now.getTime() - 3 * 864e5),
        lapseCount: 1,
      }),
    ];
    const out = rankDailyCandidates({ concepts: [a, b, c], masteries, count: 3, now });
    expect(
      out.map((x) => ({ id: x.concept.id, reason: x.reason, priority: Math.round(x.priority) })),
    ).toMatchInlineSnapshot(`
      [
        {
          "id": "b",
          "priority": 5,
          "reason": "due",
        },
        {
          "id": "c",
          "priority": 5,
          "reason": "blind_spot",
        },
        {
          "id": "a",
          "priority": -2,
          "reason": "due",
        },
      ]
    `);
  });

  it("rankDailyCandidates は difficultyLevels 非対応の concept も返す (filter は selectDailyCandidates 側で実施)", () => {
    // rankDailyCandidates 自体は pure 関数で difficulty に関与しない。
    // 実際の difficulty filter は selectDailyCandidates が DB 層で適用する設計なので、
    // ここでは rank 関数の責務が広がっていないことをスナップで確認。
    const result = rankDailyCandidates({
      concepts: [
        concept("beginner-only", [], ["beginner"]),
        concept("senior-only", [], ["senior"]),
      ],
      masteries: [],
      count: 2,
      now,
    });
    expect(result.map((r) => r.concept.id).sort()).toEqual(["beginner-only", "senior-only"]);
  });
});
