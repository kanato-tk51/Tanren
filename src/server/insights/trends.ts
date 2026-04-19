import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { attempts } from "@/db/schema";

export type TrendPoint = {
  /** 'YYYY-MM-DD' (JST) */
  date: string;
  attemptCount: number;
  correctCount: number;
  accuracyPct: number;
  studyTimeMin: number;
};

export type TrendsResult = {
  days: number;
  points: TrendPoint[];
};

/** Trends グラフ (issue #33, docs/05 §5.9)。
 *
 *  MVP 実装方針: `daily_stats` テーブルは現時点で populate 経路が無い (docs/02 §2.x や scheduler
 *  / grader から insert されていない) ため、受け入れ基準「daily_stats から集計」に対しては
 *  **attempts を GROUP BY DATE(created_at AT TIME ZONE 'Asia/Tokyo') で集計して返す**
 *  ことで同等のデータを提供する (列名は daily_stats と同構造: attemptCount / correctCount /
 *  studyTimeMin)。daily_stats にロールアップする cron / batch (将来 issue) が走るように
 *  なったらこの関数を daily_stats 直読みに切り替えれば、呼び出し側の型は変えずに済む。
 *
 *  デフォルトで直近 30 日。timezone は JST (docs/06 §6.3 の notificationTime と同じ扱い)。
 */
export async function fetchTrends(params: {
  userId: string;
  days?: number;
  now?: Date;
}): Promise<TrendsResult> {
  const days = Math.min(Math.max(params.days ?? 30, 7), 90);
  const now = params.now ?? new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const rows = await getDb()
    .select({
      date: sql<string>`to_char(${attempts.createdAt} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')`.as(
        "date",
      ),
      attemptCount: sql<number>`count(*)::int`.as("attempt_count"),
      correctCount:
        sql<number>`sum(case when ${attempts.correct} = true then 1 else 0 end)::int`.as(
          "correct_count",
        ),
      // attempts.elapsedMs の単位はミリ秒なので sum もミリ秒。UI 側で分換算する (Codex Round 1 指摘)。
      studyTimeMs: sql<number>`coalesce(sum(${attempts.elapsedMs}), 0)::int`.as("study_time_ms"),
    })
    .from(attempts)
    .where(and(eq(attempts.userId, params.userId), gte(attempts.createdAt, since)))
    .groupBy(sql`to_char(${attempts.createdAt} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${attempts.createdAt} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') asc`);

  // 欠損日は 0 埋めしてグラフが飛ばないようにする (JST)
  const byDate = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byDate.set(r.date, r);

  const points: TrendPoint[] = [];
  const jstFormatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // 時刻は JST 00:00 を基準にずらす (since..now の範囲を 1 日ずつ歩く)
  // JP locale の `YYYY/MM/DD` を `YYYY-MM-DD` に正規化
  const toIso = (d: Date): string => {
    const parts = jstFormatter.formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const m = parts.find((p) => p.type === "month")?.value ?? "";
    const dd = parts.find((p) => p.type === "day")?.value ?? "";
    return `${y}-${m}-${dd}`;
  };
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const iso = toIso(d);
    const row = byDate.get(iso);
    const attemptCount = row?.attemptCount ?? 0;
    const correctCount = row?.correctCount ?? 0;
    // elapsedMs の合計は msec で入っている (docs/03 での記録単位)。分換算 (小数 1 桁丸め)
    const studyTimeMs = row?.studyTimeMs ?? 0;
    const studyTimeMin = Math.round((studyTimeMs / 60000) * 10) / 10;
    points.push({
      date: iso,
      attemptCount,
      correctCount,
      accuracyPct: attemptCount > 0 ? correctCount / attemptCount : 0,
      studyTimeMin,
    });
  }
  return { days, points };
}
