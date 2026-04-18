import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { mastery, type Mastery } from "@/db/schema";

import { Rating, gradeMastery, scoreToRating } from "./fsrs";

/**
 * 採点直後に mastery を upsert する統合関数。
 *
 * 原子性 (docs/OPEN_QUESTIONS.md Q12):
 *   - reviewCount / lapseCount は SQL +1 で atomic
 *   - stability / nextReview などの FSRS 本体状態は read-calc-write のままで、
 *     並行 attempt で最後の writer が他方の遷移を落とす可能性が残る
 *   - 作者 1 人の MVP では並行 attempt は事実上発生しないため許容。マルチユーザー化時に
 *     websocket ドライバ + transaction、または mastery に version 列を追加して楽観ロックに切り替える。
 */
export async function updateMasteryAfterAttempt(params: {
  userId: string;
  conceptId: string;
  score: number | null;
  at?: Date;
}): Promise<Mastery> {
  const at = params.at ?? new Date();
  const db = getDb();

  const existing = await db
    .select()
    .from(mastery)
    .where(and(eq(mastery.userId, params.userId), eq(mastery.conceptId, params.conceptId)))
    .limit(1);
  const current = existing[0] ?? null;

  const update = gradeMastery({
    current: current
      ? {
          stability: current.stability,
          difficulty: current.difficulty,
          lastReview: current.lastReview,
          reviewCount: current.reviewCount,
          lapseCount: current.lapseCount,
          mastered: current.mastered,
          masteryPct: current.masteryPct,
        }
      : null,
    score: params.score,
    at,
  });

  const lapsed = update.lapseCount > (current?.lapseCount ?? 0);

  const [row] = await db
    .insert(mastery)
    .values({
      userId: params.userId,
      conceptId: params.conceptId,
      stability: update.stability,
      difficulty: update.difficulty,
      lastReview: update.lastReview,
      nextReview: update.nextReview,
      reviewCount: update.reviewCount,
      lapseCount: update.lapseCount,
      mastered: update.mastered,
      masteryPct: update.masteryPct,
    })
    .onConflictDoUpdate({
      target: [mastery.userId, mastery.conceptId],
      set: {
        stability: update.stability,
        difficulty: update.difficulty,
        lastReview: update.lastReview,
        nextReview: update.nextReview,
        // review_count / lapse_count は並行競合でも増分が落ちないよう SQL 側で atomic に +1
        reviewCount: sql`${mastery.reviewCount} + 1`,
        lapseCount: lapsed ? sql`${mastery.lapseCount} + 1` : sql`${mastery.lapseCount}`,
        mastered: update.mastered,
        masteryPct: update.masteryPct,
      },
    })
    .returning();

  if (!row) throw new Error("failed to upsert mastery");
  return row;
}

/**
 * 反論 (issue #15) 後の mastery 再適用。
 *
 * 差分:
 *   - reviewCount は再加算しない (初回 attempt で既に +1 済み)
 *   - lapseCount は「前回 Again だった ↔ 今回 Again か」の差分だけ補正 (+1 / -1 / 0)
 *   - stability / difficulty / next_review / masteryPct は新スコアで再計算
 *
 * 注意: FSRS は path-dependent なので厳密な「やり直し」ではなく近似 (MVP 許容、
 * 反論は初回採点直後の操作である想定のため誤差は小さい)。
 */
export async function reapplyMasteryAfterRebut(params: {
  userId: string;
  conceptId: string;
  previousScore: number | null;
  newScore: number | null;
  at?: Date;
}): Promise<Mastery | null> {
  const at = params.at ?? new Date();
  const db = getDb();

  const existing = await db
    .select()
    .from(mastery)
    .where(and(eq(mastery.userId, params.userId), eq(mastery.conceptId, params.conceptId)))
    .limit(1);
  const current = existing[0];
  if (!current) return null;

  const wasLapse = scoreToRating(params.previousScore) === Rating.Again;
  const willBeLapse = scoreToRating(params.newScore) === Rating.Again;

  // 「元の attempt を一度戻した状態」から新スコアで 1 回 forward して再計算
  const update = gradeMastery({
    current: {
      stability: current.stability,
      difficulty: current.difficulty,
      lastReview: current.lastReview,
      reviewCount: Math.max(0, current.reviewCount - 1),
      lapseCount: Math.max(0, current.lapseCount - (wasLapse ? 1 : 0)),
      mastered: current.mastered,
      masteryPct: current.masteryPct,
    },
    score: params.newScore,
    at,
  });

  const lapseDelta = (willBeLapse ? 1 : 0) - (wasLapse ? 1 : 0);

  const [row] = await db
    .update(mastery)
    .set({
      stability: update.stability,
      difficulty: update.difficulty,
      lastReview: update.lastReview,
      nextReview: update.nextReview,
      lapseCount: sql`GREATEST(0, ${mastery.lapseCount} + ${lapseDelta})`,
      mastered: update.mastered,
      masteryPct: update.masteryPct,
    })
    .where(and(eq(mastery.userId, params.userId), eq(mastery.conceptId, params.conceptId)))
    .returning();

  return row ?? null;
}
