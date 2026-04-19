import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { attempts, sessionsAuth, users } from "@/db/schema";

/** Weekly Digest 対象者の条件 (issue #36):
 *  - onboarding 完了済み
 *  - 直近 14 日以内にログイン活動あり (= sessions_auth に lastActiveAt >= now - 14d が存在)
 *  未ログイン 2 週間以上のユーザーには送らない (受け入れ基準)。
 */
const INACTIVE_DAYS_THRESHOLD = 14;
export const WEEKLY_WINDOW_DAYS = 7;

export type DigestMetrics = {
  userId: string;
  email: string;
  displayName: string | null;
  /** 直近 1 週間の attempt 数 */
  attemptCount: number;
  /** 直近 1 週間の正答数 */
  correctCount: number;
  /** 直近 1 週間の学習時間 (分、elapsedMs 合計を 60000 で割って小数 1 桁丸め) */
  studyTimeMin: number;
  /** 直近 1 週間で扱った concept のユニーク数 */
  conceptsTouched: number;
};

/** 送信対象ユーザー + 先週の集計を返す (issue #36) */
export async function collectWeeklyDigestTargets(now: Date = new Date()): Promise<DigestMetrics[]> {
  const db = getDb();
  const activeSince = new Date(now.getTime() - INACTIVE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000);
  const windowStart = new Date(now.getTime() - WEEKLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // 2 週間以内にログインしたユーザー (sessionsAuth.lastActiveAt で近似) のみ対象。
  // JOIN で絞るのは集計コストを下げるため。
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      attemptCount: sql<number>`count(${attempts.id})::int`.as("attempt_count"),
      correctCount:
        sql<number>`sum(case when ${attempts.correct} = true then 1 else 0 end)::int`.as(
          "correct_count",
        ),
      studyTimeMs: sql<number>`coalesce(sum(${attempts.elapsedMs}), 0)::bigint`.as("study_time_ms"),
      conceptsTouched: sql<number>`count(distinct ${attempts.conceptId})::int`.as(
        "concepts_touched",
      ),
    })
    .from(users)
    .innerJoin(sessionsAuth, eq(sessionsAuth.userId, users.id))
    // attempts は LEFT JOIN で、先週 attempt 0 件のユーザーも対象に含める判定余地を残す。
    // 実際の判定は呼び出し側 (attemptCount >= 1 なら送る 等) に委ねる。
    .leftJoin(attempts, and(eq(attempts.userId, users.id), gte(attempts.createdAt, windowStart)))
    .where(
      and(
        gte(sessionsAuth.lastActiveAt, activeSince),
        // onboarding 済み
        sql`${users.onboardingCompletedAt} IS NOT NULL`,
        // opt-out 設定が ON のユーザーのみ (issue #36 受け入れ基準)
        eq(users.weeklyDigestEnabled, true),
      ),
    )
    .groupBy(users.id, users.email, users.displayName);

  return rows.map((r) => {
    const ms = typeof r.studyTimeMs === "string" ? Number(r.studyTimeMs) : r.studyTimeMs;
    return {
      userId: r.userId,
      email: r.email,
      displayName: r.displayName,
      attemptCount: r.attemptCount ?? 0,
      correctCount: r.correctCount ?? 0,
      studyTimeMin: Math.round((ms / 60000) * 10) / 10,
      conceptsTouched: r.conceptsTouched ?? 0,
    };
  });
}

/** Digest 本文 HTML を生成 (issue #36)。MVP はテンプレベタ書き、Phase 6+ で gpt-5 要約に拡張 */
export function renderDigestHtml(m: DigestMetrics): string {
  const name = m.displayName ?? m.email;
  const accuracy =
    m.attemptCount > 0 ? `${Math.round((m.correctCount / m.attemptCount) * 100)}%` : "-";
  return `<!doctype html>
<html lang="ja">
  <body style="font-family: system-ui, -apple-system, sans-serif; color:#0f172a;">
    <h1 style="font-size:18px;">Tanren Weekly Digest</h1>
    <p>${escapeHtml(name)} さん、先週もお疲れさまでした。</p>
    <table style="border-collapse:collapse; font-size:14px;">
      <tbody>
        <tr><td>出題数</td><td><strong>${m.attemptCount} 問</strong></td></tr>
        <tr><td>正答率</td><td><strong>${accuracy}</strong></td></tr>
        <tr><td>学習時間</td><td><strong>${m.studyTimeMin} 分</strong></td></tr>
        <tr><td>触れた concept</td><td><strong>${m.conceptsTouched}</strong></td></tr>
      </tbody>
    </table>
    <p style="margin-top:16px;">
      <a href="${escapeHtml(process.env.NEXT_PUBLIC_APP_URL ?? "https://tanren.vercel.app")}/insights/trends">Trends で詳細を見る →</a>
    </p>
    <p style="color:#64748b; font-size:12px; margin-top:24px;">
      このメールを止めるには設定画面から「Weekly Digest」を OFF にしてください。
    </p>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
