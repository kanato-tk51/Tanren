import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  DEV_SESSION_COOKIE_NAME,
  LOCAL_BYPASS_OFF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/server/auth/constants";
import { destroySession, resolveSession } from "@/server/auth/session";

export async function POST() {
  const store = await cookies();
  const resolved = await resolveSession(store);
  // bypass 由来 (issue #71 着地までの暫定) は sessions_auth に行が無いので DELETE を飛ばす。
  if (resolved && resolved.kind !== "bypass") {
    await destroySession(resolved.sessionId);
  }
  store.delete(SESSION_COOKIE_NAME);
  store.delete(DEV_SESSION_COOKIE_NAME);
  // ローカル bypass 有効時でも次回リクエストで即再認証されないよう opt-out cookie を発行する。
  // cookie を消せば bypass が戻る (開発者が手動で削除できる)。
  store.set({
    name: LOCAL_BYPASS_OFF_COOKIE_NAME,
    value: "1",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  return NextResponse.json({ ok: true });
}
