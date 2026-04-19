import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { OAUTH_STATE_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/server/auth/constants";
import {
  callbackUrl,
  deserializeOAuthState,
  exchangeCodeForToken,
  fetchGithubUser,
  findUserByGithubId,
  loadGithubOAuthConfig,
} from "@/server/auth/github";
import { createSession } from "@/server/auth/session";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

function errorRedirect(request: Request, code: string): NextResponse {
  const base = new URL(request.url).origin;
  const url = new URL("/login", base);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

/** GitHub OAuth callback。state + PKCE 検証 → token 交換 → user 取得 → allowlist 照合 →
 *  既存 users 行 (bootstrap 済み) に session 発行して `/` に遷移する。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateFromGithub = url.searchParams.get("state");
  if (!code || !stateFromGithub) {
    return errorRedirect(request, "invalid_request");
  }

  const store = await cookies();
  const stateCookie = store.get(OAUTH_STATE_COOKIE_NAME)?.value;
  if (!stateCookie) {
    return errorRedirect(request, "state_expired");
  }
  const payload = deserializeOAuthState(stateCookie);
  if (!payload || payload.state !== stateFromGithub) {
    return errorRedirect(request, "state_mismatch");
  }

  // state cookie は 1 回だけ有効。以降の流れで失敗しても必ず消す。
  store.delete(OAUTH_STATE_COOKIE_NAME);

  let config;
  try {
    config = loadGithubOAuthConfig();
  } catch {
    return errorRedirect(request, "server_misconfigured");
  }

  const redirectUri = callbackUrl(request);

  let accessToken: string;
  try {
    accessToken = await exchangeCodeForToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri,
      codeVerifier: payload.codeVerifier,
    });
  } catch {
    return errorRedirect(request, "token_exchange_failed");
  }

  let githubUser;
  try {
    githubUser = await fetchGithubUser(accessToken);
  } catch {
    return errorRedirect(request, "user_fetch_failed");
  }

  if (githubUser.id !== config.allowedUserId) {
    return errorRedirect(request, "forbidden");
  }

  const existing = await findUserByGithubId(githubUser.id);
  if (!existing) {
    // bootstrap 未実行のため、DB にまだ行がない。誤ったフローで users を勝手に insert しない。
    return errorRedirect(request, "not_bootstrapped");
  }

  // GitHub 側で login を変えた場合に DB 側も追従する (表示用のみ)
  if (existing.githubLogin !== githubUser.login) {
    await getDb()
      .update(users)
      .set({ githubLogin: githubUser.login })
      .where(eq(users.id, existing.id));
  }

  const { sessionId, cookie } = await createSession(existing.id);
  const res = NextResponse.redirect(new URL("/", url.origin));
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    ...cookie,
  });
  return res;
}
