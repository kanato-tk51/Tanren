import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { pushSubscriptions, users } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { sendPushNotification } from "@/lib/push/web-push-client";

export const dynamic = "force-dynamic";

/**
 * Daily reminder を Web Push で配信する cron endpoint (issue #37)。
 * 対象: `users.webPushEnabled = true` かつ `push_subscriptions` を持つユーザー。
 * 410 Gone / 404 の subscription は DB から削除して以降の送信から除外する。
 *
 * セキュリティ: Vercel Cron からの呼び出しは `Authorization: Bearer ${CRON_SECRET}` 付き。
 * 本番で CRON_SECRET 未設定は fail-closed で 500 (Weekly Digest と同じ方針)。
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.VERCEL_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }
  } else if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const rows = await db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .innerJoin(users, eq(users.id, pushSubscriptions.userId))
    .where(eq(users.webPushEnabled, true));

  let sent = 0;
  const errors: Array<{ endpoint: string; statusCode: number; message: string }> = [];
  for (const sub of rows) {
    const result = await sendPushNotification({
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      payload: {
        title: "今日の Daily Drill",
        body: "5 問 2 分で今日の復習を始めましょう。",
        url: `${appUrl}/drill`,
      },
    });
    if (result.ok) {
      sent += 1;
      continue;
    }
    errors.push({ endpoint: sub.endpoint, statusCode: result.statusCode, message: result.message });
    // 410 Gone / 404 Not Found は subscription が失効しているので DB から削除
    if (result.statusCode === 410 || result.statusCode === 404) {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.id, sub.id), eq(pushSubscriptions.endpoint, sub.endpoint)));
    }
  }
  return NextResponse.json({ sent, errors });
}
