import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { mastery, type Mastery } from "@/db/schema";

import { gradeMastery } from "./fsrs";

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
