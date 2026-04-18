import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { DEV_SESSION_COOKIE_NAME } from "@/server/auth/constants";
import { tryDevAutoLoginUser } from "@/server/auth/dev-login";
import { createSession } from "@/server/auth/session";
import { isPasskeyEnabled } from "@/server/auth/webauthn";

/**
 * Passkey 無効環境 (Preview の一部 / 作者ローカルで WebAuthn を切った場合) の
 * ワンショット自動ログイン。Users テーブルにちょうど 1 名しかいない個人用プロダクトのみで許可。
 */
export async function POST() {
  if (isPasskeyEnabled()) {
    return NextResponse.json(
      { error: "Passkey is enabled; use /api/auth/authenticate" },
      { status: 400 },
    );
  }

  const user = await tryDevAutoLoginUser();
  if (!user) {
    return NextResponse.json(
      { error: "dev auto-login refused (no user, or multiple users exist)" },
      { status: 403 },
    );
  }

  const { sessionId, cookie } = await createSession(user.id);
  const store = await cookies();
  store.set({
    name: DEV_SESSION_COOKIE_NAME,
    value: sessionId,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    path: cookie.path,
    expires: cookie.expires,
    // __Host- prefix は使わないので Secure は本番のみ
    secure: process.env.NODE_ENV === "production",
  });
  return NextResponse.json({ ok: true, user: { id: user.id, email: user.email } });
}
