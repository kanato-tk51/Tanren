import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { concepts, mastery, type Concept, type Mastery } from "@/db/schema";

/**
 * Daily Drill 候補選定 (docs/06-architecture.md §6.4.2 の重み付け):
 *   score = overdueDays + lapseCount*2 + blindSpotBonus - masteryPct*3
 * 優先度の高い順に上位 N 件を返す。未着手 (mastery row 不在) でも
 * prereqs を全て mastered=true 満たした concept は blindSpotBonus で上位に。
 */
export const BLIND_SPOT_BONUS = 5;
export const LAPSE_WEIGHT = 2;
export const MASTERY_PENALTY = 3;

export type DailyCandidate = {
  concept: Concept;
  mastery: Mastery | null;
  /** 計算済みの priority. 大きいほど優先 */
  priority: number;
  reason: "due" | "blind_spot";
};

function daysSince(date: Date | null | undefined, now: Date): number {
  if (!date) return 0;
  return Math.max(0, (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/** 単一 concept の priority を計算 */
export function priorityFor(params: {
  concept: Concept;
  mastery: Mastery | null;
  isBlindSpot: boolean;
  now: Date;
}): number {
  const { mastery, isBlindSpot, now } = params;
  const overdueFactor = daysSince(mastery?.nextReview ?? null, now);
  const lapsePenalty = (mastery?.lapseCount ?? 0) * LAPSE_WEIGHT;
  const blindBonus = isBlindSpot ? BLIND_SPOT_BONUS : 0;
  const masteryPenalty = (mastery?.masteryPct ?? 0) * MASTERY_PENALTY;
  return overdueFactor + lapsePenalty + blindBonus - masteryPenalty;
}

export type SelectDailyInput = {
  userId: string;
  count: number;
  now?: Date;
  /**
   * 与えられた場合、この difficulty を `concept.difficultyLevels` に含む concept のみに
   * 候補を絞ってから上位 count 件を返す。Custom Session で difficulty を指定した場合に
   * 「候補が上位でしか切られず、下位に唯一の match が埋もれる」問題を避けるため、
   * filter は scoring/slicing の前に適用する。
   */
  difficultyFilter?: string;
};

/**
 * Daily Drill の候補を選定する純粋関数版。
 * DB から concepts と mastery を取得し、候補スコアでソートして上位 count 件を返す。
 */
export async function selectDailyCandidates(input: SelectDailyInput): Promise<DailyCandidate[]> {
  const now = input.now ?? new Date();
  const db = getDb();

  const [conceptRows, masteryRows] = await Promise.all([
    db.select().from(concepts),
    db.select().from(mastery).where(eq(mastery.userId, input.userId)),
  ]);

  const filtered = input.difficultyFilter
    ? conceptRows.filter((c) =>
        c.difficultyLevels.includes(input.difficultyFilter as (typeof c.difficultyLevels)[number]),
      )
    : conceptRows;

  return rankDailyCandidates({
    concepts: filtered,
    masteries: masteryRows,
    count: input.count,
    now,
  });
}

export const BLIND_SPOT_CANDIDATE_CAP = 2;

/**
 * DB 層から分離した純粋ロジック (テスト容易)。
 * docs/06 §6.4.1 に準じて:
 *   1. due (next_review <= now) を全件集める
 *   2. blind_spot (未着手かつ prereqs 全 mastered) を最大 2 件集める
 *      (user がまだ何も履修していない "bootstrap" 時は prereqs が空の concept を blind_spot 扱い)
 *   3. [due, blind_spot] を合算して priority 降順で上位 count 件を返す
 */
export function rankDailyCandidates(params: {
  concepts: Concept[];
  masteries: Mastery[];
  count: number;
  now: Date;
}): DailyCandidate[] {
  const masteryByConcept = new Map(params.masteries.map((m) => [m.conceptId, m]));
  const masteredIds = new Set(
    params.masteries.filter((m) => m.mastered === true).map((m) => m.conceptId),
  );

  const due: DailyCandidate[] = [];
  const blindSpots: DailyCandidate[] = [];

  for (const concept of params.concepts) {
    const m = masteryByConcept.get(concept.id) ?? null;
    if (m) {
      // 既に取り組んでいる concept: next_review <= now なら due
      if (m.nextReview && m.nextReview.getTime() <= params.now.getTime()) {
        due.push({
          concept,
          mastery: m,
          priority: priorityFor({ concept, mastery: m, isBlindSpot: false, now: params.now }),
          reason: "due",
        });
      }
    } else {
      const prereqs = concept.prereqs ?? [];
      const prereqsSatisfied = prereqs.length === 0 || prereqs.every((id) => masteredIds.has(id));
      if (prereqsSatisfied) {
        blindSpots.push({
          concept,
          mastery: null,
          priority: priorityFor({
            concept,
            mastery: null,
            isBlindSpot: true,
            now: params.now,
          }),
          reason: "blind_spot",
        });
      }
    }
  }

  // blind_spot は最大 2 件にクランプしてから due と合算し、priority 降順で上位 count 件
  const blindCapped = blindSpots
    .sort((a, b) => b.priority - a.priority)
    .slice(0, BLIND_SPOT_CANDIDATE_CAP);
  const pool = [...due, ...blindCapped].sort((a, b) => b.priority - a.priority);
  return pool.slice(0, params.count);
}
