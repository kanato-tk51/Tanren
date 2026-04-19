import { NextResponse } from "next/server";

import { runPregenerateBatch } from "@/server/batch/pregenerate";

export const dynamic = "force-dynamic";
/** LLM 呼び出しで Vercel Functions default 10s を超えるため 60s まで拡張 (Hobby 上限) */
export const maxDuration = 60;

/**
 * 問題の事前生成バッチ cron (issue #39, docs/03 §3.3.4)。
 * 未充足の (concept, difficulty, thinkingStyle) 組合せを補充し、出題時レイテンシを下げる。
 *
 * Vercel Cron 側は Hobby プランなら日次 (schedule: 18:00 UTC = 03:00 JST)。
 * Pro プランなら 4 時間ごと (0/4 * * *) に縮退も選択肢 (受け入れ基準の注記)。
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

  const result = await runPregenerateBatch();
  return NextResponse.json(result);
}
