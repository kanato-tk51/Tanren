import { Rating, createEmptyCard, fsrs, type Card, type Grade, type ReviewLog } from "ts-fsrs";

import type { Mastery } from "@/db/schema";

/**
 * docs/02-learning-system.md §2.4 の FSRS v5 ラッパ。
 * - scoreToRating: 0.0-1.0 のスコアから Again/Hard/Good/Easy を決める
 * - gradeMastery: 現在の mastery と新規 attempt 結果から次回 mastery 値を計算
 */

/**
 * Grade = Again | Hard | Good | Easy (Manual は除外)。
 * mcq (0 or 1) は Again / Easy の二値。short / written の部分正解 (0.5 <= score < 0.9) は
 * Hard として FSRS に送る (docs/02-learning-system.md §2.4 / issue #14 受け入れ基準)。
 */
export function scoreToRating(score: number | null): Grade {
  if (score === null) return Rating.Again;
  if (score >= 0.95) return Rating.Easy;
  if (score >= 0.9) return Rating.Good;
  if (score >= 0.5) return Rating.Hard;
  return Rating.Again;
}

export type MasteryInput = Pick<
  Mastery,
  | "stability"
  | "difficulty"
  | "lastReview"
  | "reviewCount"
  | "lapseCount"
  | "mastered"
  | "masteryPct"
>;

export type MasteryUpdateResult = {
  stability: number;
  difficulty: number;
  lastReview: Date;
  nextReview: Date;
  reviewCount: number;
  lapseCount: number;
  mastered: boolean;
  masteryPct: number;
  log: ReviewLog;
};

/** mastery_pct は reviewCount / 15 を上限 0-1 にクリップ (MVP ざっくり) */
function computeMasteryPct(reviewCount: number, lapseCount: number): number {
  const base = Math.min(1, reviewCount / 15);
  const penalty = Math.min(0.3, lapseCount * 0.1);
  return Math.max(0, base - penalty);
}

const scheduler = fsrs();

/**
 * 10 分ルール: Again 時は next_review を now + 10 分で上書き (docs/02 §2.4.4 相当)。
 * ts-fsrs の出す interval が長すぎると「間違えた直後なのに次回は 1 日後」になるため。
 */
const AGAIN_NEXT_REVIEW_MS = 10 * 60 * 1000;

/** mastery の現在値 (未登録なら null) と attempt の結果から次回の mastery 値を返す */
export function gradeMastery(params: {
  current: MasteryInput | null;
  score: number | null;
  at: Date;
}): MasteryUpdateResult {
  const rating = scoreToRating(params.score);

  // ts-fsrs の Card 形式に変換。初回 (current=null) は空カード
  const currentCard: Card = params.current
    ? {
        due: params.current.lastReview ?? params.at,
        stability: params.current.stability ?? 0,
        difficulty: params.current.difficulty ?? 0,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: params.current.reviewCount,
        lapses: params.current.lapseCount,
        state: 2, // Review state
        last_review: params.current.lastReview ?? undefined,
        learning_steps: 0,
      }
    : createEmptyCard(params.at);

  const scheduled = scheduler.next(currentCard, params.at, rating);

  let nextReview = scheduled.card.due;
  // Again のときは 10 分ルールで押さえる
  if (rating === Rating.Again) {
    const tenMinAway = new Date(params.at.getTime() + AGAIN_NEXT_REVIEW_MS);
    if (nextReview.getTime() > tenMinAway.getTime()) {
      nextReview = tenMinAway;
    }
  }

  const reviewCount = (params.current?.reviewCount ?? 0) + 1;
  const lapseCount = (params.current?.lapseCount ?? 0) + (rating === Rating.Again ? 1 : 0);
  const masteryPct = computeMasteryPct(reviewCount, lapseCount);
  const mastered = masteryPct >= 0.8;

  return {
    stability: scheduled.card.stability,
    difficulty: scheduled.card.difficulty,
    lastReview: params.at,
    nextReview,
    reviewCount,
    lapseCount,
    mastered,
    masteryPct,
    log: scheduled.log,
  };
}

export { Rating };
