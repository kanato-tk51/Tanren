import { DIFFICULTY_LEVELS, type Concept, type DifficultyLevel } from "@/db/schema";

/** 3 連続正解で 1 段昇格 (docs/02-learning-system.md §2.4.5) */
export const STREAK_FOR_PROMOTION = 3;

/**
 * Daily Drill で自動昇格できる上限。senior 以上は明示指定のみ (ADR-0001)。
 */
export const DAILY_AUTO_PROMOTION_CAP: DifficultyLevel = "mid";

/** concept の許可 difficulty のうち、現在の difficulty から 1 段上で許可される値 */
export function nextAllowedDifficulty(
  concept: Pick<Concept, "difficultyLevels">,
  current: DifficultyLevel,
  cap: DifficultyLevel = DAILY_AUTO_PROMOTION_CAP,
): DifficultyLevel | null {
  const levels = concept.difficultyLevels;
  const currentIdx = DIFFICULTY_LEVELS.indexOf(current);
  const capIdx = DIFFICULTY_LEVELS.indexOf(cap);
  if (currentIdx < 0 || capIdx < 0) return null;
  for (let i = currentIdx + 1; i <= capIdx; i++) {
    const level = DIFFICULTY_LEVELS[i];
    if (level && levels.includes(level)) return level;
  }
  return null;
}

/**
 * 直近の attempts から連続正解数を数え、n 連続正解なら 1 段昇格する difficulty を返す。
 * 連続が足りないか昇格可能な上位難易度がなければ null。
 */
export function computePromotion(params: {
  concept: Pick<Concept, "difficultyLevels">;
  currentDifficulty: DifficultyLevel;
  /** 新しい順。最大 STREAK_FOR_PROMOTION 件見れば足りる */
  recentCorrect: boolean[];
  cap?: DifficultyLevel;
}): DifficultyLevel | null {
  const streak = params.recentCorrect.slice(0, STREAK_FOR_PROMOTION);
  if (streak.length < STREAK_FOR_PROMOTION) return null;
  if (!streak.every((c) => c === true)) return null;
  return nextAllowedDifficulty(params.concept, params.currentDifficulty, params.cap);
}
