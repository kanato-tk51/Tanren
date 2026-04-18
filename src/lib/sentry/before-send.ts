import type { ErrorEvent } from "@sentry/nextjs";

/** Sentry beforeSend hook 共通 (issue #27)。
 *  PII (個人情報) 漏洩を防ぐため、以下を必ず潰してから送信する:
 *    - user.email / user.username (id だけは残す)
 *    - request.headers.cookie / authorization (セッション cookie が混入しないように)
 *    - request.cookies, query_string (PII / トークンが乗りやすい)
 *    - extra / contexts.user.{email, ip_address}
 *
 *  注意: ここで DSN 有無のチェックはしない。
 *    - browser bundle では `process.env.SENTRY_DSN` は常に undefined (Next.js は NEXT_PUBLIC_*
 *      以外を bundle に展開しない) なので、DSN ガードを置くと client 側のすべてのイベントが
 *      落ちて Sentry に届かなくなる (Codex Round 1 指摘 #1)。
 *    - DSN 未設定時は呼び出し側 (sentry.{client,server,edge}.config.ts) が `Sentry.init` 自体を
 *      skip するため、beforeSend は呼ばれない。二重ガードは不要。
 */
export function tanrenBeforeSend(event: ErrorEvent): ErrorEvent | null {
  // request 周り
  if (event.request) {
    if (event.request.headers) {
      delete event.request.headers.cookie;
      delete event.request.headers.Cookie;
      delete event.request.headers.authorization;
      delete event.request.headers.Authorization;
    }
    delete event.request.cookies;
    delete event.request.query_string;
    delete event.request.data;
  }

  // user の email / ip / username は残さない (id だけ残す)
  if (event.user) {
    const { id } = event.user;
    event.user = id ? { id } : undefined;
  }

  // contexts に潜む個人情報も削る (Sentry SDK が自動収集する範囲)
  if (event.contexts) {
    if (event.contexts.user) {
      const { id } = event.contexts.user as { id?: string };
      event.contexts.user = id ? { id } : undefined;
    }
    delete (event.contexts as Record<string, unknown>).device;
    delete (event.contexts as Record<string, unknown>).os;
  }

  return event;
}
