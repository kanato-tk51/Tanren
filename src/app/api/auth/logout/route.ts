import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { DEV_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/server/auth/constants";
import { destroySession, resolveSession } from "@/server/auth/session";

export async function POST() {
  const store = await cookies();
  const resolved = await resolveSession(store);
  if (resolved) {
    await destroySession(resolved.sessionId);
  }
  store.delete(SESSION_COOKIE_NAME);
  store.delete(DEV_SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
