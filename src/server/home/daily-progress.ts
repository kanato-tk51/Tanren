import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { attempts } from "@/db/schema";
import { jstStartOfToday } from "@/lib/jst";

export type DailyProgress = {
  /** JST 00:00 以降のその user の attempt 件数 */
  attemptCount: number;
};

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
