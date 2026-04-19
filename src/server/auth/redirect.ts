import "server-only";

import { NextResponse } from "next/server";

import type { OAuthErrorCode } from "./errors";

/** 公開アプリの base URL (scheme+host+port) を返す。優先順位:
 *  1. `NEXT_PUBLIC_APP_URL` (Vercel Production / Preview で設定)
 *  2. `GITHUB_CALLBACK_URL` が設定されていればその origin (reverse proxy の明示 override)
 *  3. request の origin (ローカル dev のデフォルト)
 *
 *  reverse proxy の内側で `request.url.host` が内部 host になるケースに対応するため、
 *  明示 env が優先 (Codex PR#86 Round 4 指摘 #1)。 */
export function publicBaseUrl(request: Request): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) return appUrl.replace(/\/+$/, "");
  const callbackOverride = process.env.GITHUB_CALLBACK_URL;
  if (callbackOverride) {
    try {
      return new URL(callbackOverride).origin;
    } catch {
      // fall through
    }
  }
  return new URL(request.url).origin;
}

/** /login?error=<code> にリダイレクトする共通 helper。login / callback の両方で使う
 *  (Codex PR#86 Round 4 指摘 #2 の重複回避)。`code` は `OAuthErrorCode` 列挙のいずれか。 */
export function redirectToLoginError(request: Request, code: OAuthErrorCode): NextResponse {
  const url = new URL("/login", publicBaseUrl(request));
  url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}
