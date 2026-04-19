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
  fetchPrimaryEmail,
  findUserByGithubId,
  loadGithubOAuthConfig,
} from "@/server/auth/github";
import { publicBaseUrl, redirectToLoginError as errorRedirect } from "@/server/auth/redirect";
import { createSession } from "@/server/auth/session";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

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

  // Weekly Digest は users.email IS NOT NULL のユーザーだけを対象にするため、email が
  // ない既存行には落とし込んでおく (Codex PR#86 Round 1 指摘 #2)。`/user` の email が
  // 非公開設定で null の場合、`user:email` scope + `/user/emails` 経由で primary
  // verified を取得する。取れなければ skip (既存 email を上書きしない)。
  let primaryEmail: string | null | undefined = githubUser.email ?? undefined;
  if (!primaryEmail && !existing.email) {
    // /user/emails は補完扱い。ネットワーク失敗やタイムアウトで login 全体を落とさない
    // (Codex PR#86 Round 3 指摘 #2)。取れなければ email=null で続行する。
    try {
      primaryEmail = await fetchPrimaryEmail(accessToken);
    } catch {
      primaryEmail = null;
    }
  }

  const patch: Partial<typeof users.$inferInsert> = {};
  if (existing.githubLogin !== githubUser.login) {
    patch.githubLogin = githubUser.login;
  }
  // email は一度セットされたらユーザーの意思で変更されるまで上書きしない (OAuth で
  // primary email を途中で切り替えると既存 digest 受信者が予告なく変わるのを避ける)。
  if (!existing.email && primaryEmail) {
    patch.email = primaryEmail;
  }
  if (Object.keys(patch).length > 0) {
    await getDb().update(users).set(patch).where(eq(users.id, existing.id));
  }

  const { sessionId, cookie } = await createSession(existing.id);
  // 公開 base URL を使って `/` にリダイレクト (reverse proxy 環境で request.url.origin が
  // 内部 host になるケースに対応、Codex PR#86 Round 4 指摘 #1)。
  const res = NextResponse.redirect(new URL("/", publicBaseUrl(request)));
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    ...cookie,
  });
  return res;
}
