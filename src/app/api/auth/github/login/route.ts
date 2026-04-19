import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { OAUTH_STATE_COOKIE_NAME, OAUTH_STATE_TTL_MS } from "@/server/auth/constants";
import {
  buildAuthorizeUrl,
  callbackUrl,
  codeChallengeFromVerifier,
  generatePkce,
  loadGithubOAuthConfig,
  serializeOAuthState,
} from "@/server/auth/github";

export const dynamic = "force-dynamic";

function errorRedirect(request: Request, code: string): NextResponse {
  const url = new URL("/login", new URL(request.url).origin);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

/** GitHub OAuth フロー開始。state + code_verifier を cookie に保存して GitHub にリダイレクト。 */
export async function GET(request: Request) {
  let config;
  try {
    config = loadGithubOAuthConfig();
  } catch {
    // callback と契約を揃える: /login?error=server_misconfigured に戻して UI 側の日本語
    // メッセージを表示する (Codex PR#86 Round 3 指摘 #1)。
    return errorRedirect(request, "server_misconfigured");
  }

  const pkce = generatePkce();
  const redirectUri = callbackUrl(request);
  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri,
    state: pkce.state,
    codeChallenge: codeChallengeFromVerifier(pkce.codeVerifier),
  });

  const res = NextResponse.redirect(authorizeUrl);
  // login → callback で GitHub からリダイレクトされて戻ってくる (cross-site navigation)
  // ため、SameSite=Lax が必要。httpOnly + secure でセキュア属性は維持する。
  const store = await cookies();
  store.set({
    name: OAUTH_STATE_COOKIE_NAME,
    value: serializeOAuthState(pkce),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  });
  return res;
}
