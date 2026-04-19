import { NextResponse } from "next/server";

import { getResend, resendFromEmail } from "@/lib/email/resend-client";
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
  // CRON_SECRET 認可。
  // - production: 必ず設定されていないと 500 (fail-closed、Codex Round 1 指摘 C)
  // - preview / dev: 未設定ならスキップ (ローカル動作を楽にする)
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.VERCEL_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }
  } else if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
      await resend.emails.send({
        from,
        to: t.email,
        subject: "Tanren Weekly Digest",
        html: renderDigestHtml(t),
      });
      sent += 1;
    } catch (err) {
      errors.push({ userId: t.userId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ sent, skipped, errors });
}
