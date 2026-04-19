import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { attempts } from "@/db/schema";

export type DailyProgress = {
  /** JST 00:00 以降のその user の attempt 件数 */
  attemptCount: number;
};

/** Asia/Tokyo (JST, UTC+9) 固定で「今日の 00:00 (UTC 換算)」を返す。
 *  insights/history.ts の jstPeriodBounds と同じ基準で日付切り替えを揃えるための共有境界。
 */
export function jstStartOfToday(now: Date = new Date()): Date {
  const nowJstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  const jstStartOfTodayMs = Math.floor(nowJstMs / dayMs) * dayMs;
  return new Date(jstStartOfTodayMs - 9 * 60 * 60 * 1000);
}

/** ホーム画面の「今日の進捗 (N/dailyGoal 問)」表示用の軽量クエリ。
 *  attempts を COUNT するだけで、history の pagination ルートは使わない
 *  (毎回全件フェッチしないため)。
 */
export async function fetchDailyProgress(params: {
  userId: string;
  now?: Date;
}): Promise<DailyProgress> {
  const since = jstStartOfToday(params.now);
  const rows = await getDb()
    .select({ count: sql<number>`count(*)::int`.as("count") })
    .from(attempts)
    .where(and(eq(attempts.userId, params.userId), gte(attempts.createdAt, since)));
  const count = rows[0]?.count ?? 0;
  return { attemptCount: count };
}
