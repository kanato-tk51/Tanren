import "server-only";

import { NextResponse } from "next/server";

/** cron endpoint の CRON_SECRET 認可共通ヘルパ (Codex PR#83 Round 5 指摘 #3)。
 *  - 未設定: `failClosedOn` に応じて該当環境では 500 / それ以外は bypass (ローカル dev 用)
 *  - 設定あり: `Authorization: Bearer ${CRON_SECRET}` 不一致なら 401
 *
 *  ok=true のとき null 相当、ng のとき NextResponse を返す。呼び出し側は null チェックで早期 return。
 */
export function verifyCronAuth(
  req: Request,
  opts: { failClosedOn: "production" | "production-and-preview" },
): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  const vercelEnv = process.env.VERCEL_ENV;
  const isProd = vercelEnv === "production";
  const isPreview = vercelEnv === "preview";
  const requiresAuth =
    opts.failClosedOn === "production-and-preview" ? isProd || isPreview : isProd;
  if (!cronSecret) {
    if (requiresAuth) {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }
    return null;
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
