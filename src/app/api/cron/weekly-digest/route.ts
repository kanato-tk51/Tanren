import { NextResponse } from "next/server";

import { getResend, resendFromEmail } from "@/lib/email/resend-client";
import { verifyCronAuth } from "@/server/cron/auth";
import { collectWeeklyDigestTargets, renderDigestHtml } from "@/server/digest/weekly-digest";

export const dynamic = "force-dynamic";

/**
 * Weekly Digest cron エンドポイント (issue #36)。
 * Vercel Cron で日曜 09:00 JST = 00:00 UTC に叩く想定 (vercel.ts 側で schedule 設定)。
 *
 * セキュリティ:
 *   - Vercel Cron は同プロジェクトから呼ばれる際 `Authorization: Bearer ${CRON_SECRET}`
 *     を付けるので、未設定 / 不一致なら 401。外部からの re-trigger を防ぐ。
 *   - RESEND_API_KEY / RESEND_FROM_EMAIL 未設定なら 501 (メール送信無効)。
 *
 * 戻り値: { sent: number, skipped: number, errors: Array<{userId, error}> }
 */
export async function GET(req: Request) {
  // CRON_SECRET 認可 (src/server/cron/auth.ts に集約、Codex PR#83 Round 5 指摘 #3)。
  // production のみ fail-closed。メール送信はコスト低なので preview も bypass 許容。
  const authFail = verifyCronAuth(req, { failClosedOn: "production" });
  if (authFail) return authFail;

  const resend = getResend();
  const from = resendFromEmail();
  if (!resend || !from) {
    return NextResponse.json(
      { error: "RESEND_API_KEY / RESEND_FROM_EMAIL が未設定" },
      { status: 501 },
    );
  }

  const targets = await collectWeeklyDigestTargets();
  const errors: Array<{ userId: string; error: string }> = [];
  let sent = 0;
  let skipped = 0;
  for (const t of targets) {
    // 先週 0 問のユーザーには送らない (空の digest は逆効果)
    if (t.attemptCount === 0) {
      skipped += 1;
      continue;
    }
    try {
      // Resend SDK は API エラー時に throw せず { data, error } を返すことがあるので、
      // error を明示的に受け取って判定する (Codex Round 2 指摘 #1)。
      const result = await resend.emails.send({
        from,
        to: t.email,
        subject: "Tanren Weekly Digest",
        html: renderDigestHtml(t),
      });
      if (result.error) {
        errors.push({ userId: t.userId, error: result.error.message ?? String(result.error) });
      } else {
        sent += 1;
      }
    } catch (err) {
      errors.push({ userId: t.userId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ sent, skipped, errors });
}
