import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { mastery, type Mastery } from "@/db/schema";

import { gradeMastery } from "./fsrs";

/**
 * 採点直後に mastery を upsert する統合関数。grader からフローで呼ばれる想定。
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

  const values = {
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
  };

  const [row] = await db
    .insert(mastery)
    .values(values)
    .onConflictDoUpdate({
      target: [mastery.userId, mastery.conceptId],
      set: {
        stability: values.stability,
        difficulty: values.difficulty,
        lastReview: values.lastReview,
        nextReview: values.nextReview,
        reviewCount: values.reviewCount,
        lapseCount: values.lapseCount,
        mastered: values.mastered,
        masteryPct: values.masteryPct,
      },
    })
    .returning();

  if (!row) throw new Error("failed to upsert mastery");
  return row;
}
