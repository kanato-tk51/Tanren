import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { attempts, concepts, mastery, type Concept, type Mastery } from "@/db/schema";

export type OverviewItem = {
  conceptId: string;
  conceptName: string;
  domainId: string;
  subdomainId: string;
  masteryPct: number;
  /** 関連 attempts 数 (weakest 表示で「○問中 ○問ミス」に使う) */
  attemptCount: number;
  /** 直近誤答数 (最終20件内) */
  recentWrongCount?: number;
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

  // concepts × mastery を user 軸で LEFT JOIN して 1 行 1 concept に正規化
  const conceptRows: Concept[] = await db.select().from(concepts);
  const masteryRows: Mastery[] = await db.select().from(mastery).where(eq(mastery.userId, userId));

  // attempts の concept 別カウント (全期間)
  const attemptCountRows = await db
    .select({
      conceptId: attempts.conceptId,
      total: sql<number>`count(*)::int`.as("total"),
    })
    .from(attempts)
    .where(eq(attempts.userId, userId))
    .groupBy(attempts.conceptId);
  const attemptCountByConcept = new Map(attemptCountRows.map((r) => [r.conceptId, r.total]));

  // 直近 20 件の誤答を concept 別に数える (weakest の「8 問中 5 問ミス」など)
  const recentWrongRows = await db
    .select({
      conceptId: attempts.conceptId,
      correct: attempts.correct,
    })
    .from(attempts)
    .where(and(eq(attempts.userId, userId)))
    .orderBy(desc(attempts.createdAt))
    .limit(200);
  const recentWrongByConcept = new Map<string, number>();
  for (const r of recentWrongRows) {
    if (r.correct === false) {
      recentWrongByConcept.set(r.conceptId, (recentWrongByConcept.get(r.conceptId) ?? 0) + 1);
    }
  }

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
      recentWrongCount: recentWrongByConcept.get(c.id) ?? 0,
      lastReview: m?.lastReview ?? null,
    };
  });

  // Strongest: mastered=true または masteryPct 高い順に attempts 1 件以上の上位 3
  const strongest = items
    .filter((i) => i.attemptCount > 0)
    .sort((a, b) => b.masteryPct - a.masteryPct)
    .slice(0, TOP_N);

  // Weakest: attempts >= 5 かつ masteryPct < 0.5 の中で masteryPct 昇順 (= 弱い順) 上位 3
  const weakest = items
    .filter(
      (i) => i.attemptCount >= WEAKEST_MIN_ATTEMPTS && i.masteryPct < WEAKEST_MASTERY_THRESHOLD,
    )
    .sort((a, b) => a.masteryPct - b.masteryPct)
    .slice(0, TOP_N);

  // Blind spots: attempts=0 かつ prereqs 全て mastered (daily と同じ判定)
  const blindSpots = items
    .filter((i) => {
      if (i.attemptCount !== 0) return false;
      const concept = conceptRows.find((c) => c.id === i.conceptId);
      if (!concept) return false;
      const prereqs = concept.prereqs ?? [];
      return prereqs.length === 0 || prereqs.every((pid) => masteredIds.has(pid));
    })
    .slice(0, TOP_N);

  // Decaying: mastered=false かつ最終レビューが DECAYING_DAYS 日以上前
  const decaying = items
    .filter((i) => {
      if (!i.lastReview) return false;
      if (i.attemptCount === 0) return false;
      const days = (now.getTime() - i.lastReview.getTime()) / (1000 * 60 * 60 * 24);
      return days >= DECAYING_DAYS && i.masteryPct < 0.8;
    })
    .sort((a, b) => {
      // 古い順 (忘却進行度合いが大きい順)
      const aDate = a.lastReview?.getTime() ?? 0;
      const bDate = b.lastReview?.getTime() ?? 0;
      return aDate - bDate;
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
