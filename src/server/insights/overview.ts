import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { attempts, concepts, mastery, type Concept, type Mastery } from "@/db/schema";
import { arePrereqsSatisfied } from "@/server/scheduler/blind-spot";

export type OverviewItem = {
  conceptId: string;
  conceptName: string;
  domainId: string;
  subdomainId: string;
  masteryPct: number;
  /** この concept の全期間 attempts 総数 */
  attemptCount: number;
  /** 全期間の誤答数 (weakest で「N 問中 M 問ミス」に使う、両方とも同じ窓=全期間) */
  wrongCount: number;
  /** 最終レビュー (decaying に使う) */
  lastReview: Date | null;
};

export type InsightsOverview = {
  totalConcepts: number;
  masteredConcepts: number;
  masteryPct: number;
  strongest: OverviewItem[];
  weakest: OverviewItem[];
  blindSpots: OverviewItem[];
  decaying: OverviewItem[];
};

const TOP_N = 3;
/** weakest 条件: 5 attempt 以上、masteryPct < 0.5 */
const WEAKEST_MIN_ATTEMPTS = 5;
const WEAKEST_MASTERY_THRESHOLD = 0.5;
/** decaying 判定: 最終レビューが N 日以上前かつ mastered=false */
const DECAYING_DAYS = 7;

/**
 * Insights Dashboard (`/insights`) の overview 集計 (issue #20, docs/05 §5.3)。
 * 1 user の attempts × concepts × mastery を結合して、強み / 弱点 / 盲点 / 忘却中 の
 * Top3 を数値だけで返す。Recharts などの可視化は Phase 5+ (issue #29, #33)。
 */
export async function fetchInsightsOverview(userId: string): Promise<InsightsOverview> {
  const db = getDb();
  const now = new Date();

  // concepts / mastery / attempts を user 軸でメモリ上 join (3 クエリを JS 側で合成)。
  const conceptRows: Concept[] = await db.select().from(concepts);
  const masteryRows: Mastery[] = await db.select().from(mastery).where(eq(mastery.userId, userId));

  // attempts の concept 別カウント (全期間の total と wrong を一括集計)
  // weakest 表示 (「N 問中 M 問ミス」) が同じ時間窓になるよう attemptCount と wrongCount は
  // どちらも「全期間」で揃える (Round 1 指摘: 時間窓混在を避ける)。
  const attemptCountRows = await db
    .select({
      conceptId: attempts.conceptId,
      total: sql<number>`count(*)::int`.as("total"),
      wrong: sql<number>`sum(case when ${attempts.correct} = false then 1 else 0 end)::int`.as(
        "wrong",
      ),
    })
    .from(attempts)
    .where(eq(attempts.userId, userId))
    .groupBy(attempts.conceptId);
  const attemptCountByConcept = new Map(attemptCountRows.map((r) => [r.conceptId, r.total]));
  const wrongCountByConcept = new Map(attemptCountRows.map((r) => [r.conceptId, r.wrong ?? 0]));

  const masteryByConcept = new Map(masteryRows.map((m) => [m.conceptId, m]));
  const masteredIds = new Set(masteryRows.filter((m) => m.mastered).map((m) => m.conceptId));

  const items: OverviewItem[] = conceptRows.map((c) => {
    const m = masteryByConcept.get(c.id);
    return {
      conceptId: c.id,
      conceptName: c.name,
      domainId: c.domainId,
      subdomainId: c.subdomainId,
      masteryPct: m?.masteryPct ?? 0,
      attemptCount: attemptCountByConcept.get(c.id) ?? 0,
      wrongCount: wrongCountByConcept.get(c.id) ?? 0,
      lastReview: m?.lastReview ?? null,
    };
  });

  // Strongest: attempts 1 件以上の concept を masteryPct 降順、同率なら conceptId で安定ソート
  const strongest = items
    .filter((i) => i.attemptCount > 0)
    .sort((a, b) => b.masteryPct - a.masteryPct || a.conceptId.localeCompare(b.conceptId))
    .slice(0, TOP_N);

  // Weakest: attempts >= 5 かつ masteryPct < 0.5 の中で masteryPct 昇順 (= 弱い順) 上位 3。
  // 同率は conceptId 昇順で安定化。
  const weakest = items
    .filter(
      (i) => i.attemptCount >= WEAKEST_MIN_ATTEMPTS && i.masteryPct < WEAKEST_MASTERY_THRESHOLD,
    )
    .sort((a, b) => a.masteryPct - b.masteryPct || a.conceptId.localeCompare(b.conceptId))
    .slice(0, TOP_N);

  // Blind spots: attempts=0 かつ prereqs 全て mastered
  // (daily の rankDailyCandidates と同じ prereq 判定ロジックを共有 helper で使う)。
  // domain → subdomain → id の順で安定ソートして表示の再現性を確保。
  const conceptById = new Map(conceptRows.map((c) => [c.id, c]));
  const blindSpots = items
    .filter((i) => {
      if (i.attemptCount !== 0) return false;
      const concept = conceptById.get(i.conceptId);
      if (!concept) return false;
      return arePrereqsSatisfied(concept, masteredIds);
    })
    .sort(
      (a, b) =>
        a.domainId.localeCompare(b.domainId) ||
        a.subdomainId.localeCompare(b.subdomainId) ||
        a.conceptId.localeCompare(b.conceptId),
    )
    .slice(0, TOP_N);

  // Decaying: mastered=false かつ最終レビューが DECAYING_DAYS 日以上前。
  // 古い順 (忘却進行度合いが大きい順)。同日の場合は conceptId で安定化 (Round 5 指摘)。
  const decaying = items
    .filter((i) => {
      if (!i.lastReview) return false;
      if (i.attemptCount === 0) return false;
      const days = (now.getTime() - i.lastReview.getTime()) / (1000 * 60 * 60 * 24);
      return days >= DECAYING_DAYS && i.masteryPct < 0.8;
    })
    .sort((a, b) => {
      const aDate = a.lastReview?.getTime() ?? 0;
      const bDate = b.lastReview?.getTime() ?? 0;
      return aDate - bDate || a.conceptId.localeCompare(b.conceptId);
    })
    .slice(0, TOP_N);

  return {
    totalConcepts: conceptRows.length,
    masteredConcepts: masteredIds.size,
    masteryPct: conceptRows.length > 0 ? masteredIds.size / conceptRows.length : 0,
    strongest,
    weakest,
    blindSpots,
    decaying,
  };
}
