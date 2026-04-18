import type { ErrorEvent } from "@sentry/nextjs";

/** 機密ヘッダ名の一覧 (大文字小文字を normalize してから比較)。
 *  Tanren 本体が明示的に載せているものは `cookie` と `__Host-tanren_session` だけだが、
 *  Vercel / Next.js middleware / 外部 API 呼び出しが勝手に付けるケースを含めて広めにカバー。
 */
const REDACTED_HEADER_NAMES = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
]);

/** URL から query string と fragment を落とす。相対 URL / 不正な値にも耐える */
function stripQueryAndFragment(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const q = url.indexOf("?");
  const h = url.indexOf("#");
  const end = q >= 0 && h >= 0 ? Math.min(q, h) : q >= 0 ? q : h >= 0 ? h : url.length;
  return url.slice(0, end);
}

/** Sentry beforeSend hook 共通 (issue #27)。
 *  PII (個人情報) 漏洩を防ぐため、以下を潰してから送信する:
 *    - request.headers の機密系 (REDACTED_HEADER_NAMES、大文字小文字不問)
 *    - request.cookies / query_string / data
 *    - request.url の query / fragment (Codex Round 2 指摘 #1)
 *    - breadcrumbs[].data.url / to の query / fragment (fetch / xhr / navigation、Codex Round 2 指摘 #2)
 *    - user.email / username / ip_address (id だけ残す)
 *    - contexts.device / os
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
      for (const key of Object.keys(event.request.headers)) {
        if (REDACTED_HEADER_NAMES.has(key.toLowerCase())) {
          delete event.request.headers[key];
        }
      }
    }
    delete event.request.cookies;
    delete event.request.query_string;
    delete event.request.data;
    // url に query / fragment が残ると query_string 削除の意味がないので同じ扱いで落とす
    if (typeof event.request.url === "string") {
      const stripped = stripQueryAndFragment(event.request.url);
      if (stripped !== undefined) event.request.url = stripped;
    }
  }

  // breadcrumbs (fetch / xhr / navigation) の url / to から query / fragment を落とす。
  // 削除ではなく query/fragment だけ切るのは、どのパスで発生したかのデバッグ性を残すため。
  if (event.breadcrumbs) {
    for (const b of event.breadcrumbs) {
      if (!b.data) continue;
      const d = b.data as { url?: unknown; to?: unknown; from?: unknown };
      const nextUrl = stripQueryAndFragment(d.url);
      if (nextUrl !== undefined) d.url = nextUrl;
      const nextTo = stripQueryAndFragment(d.to);
      if (nextTo !== undefined) d.to = nextTo;
      const nextFrom = stripQueryAndFragment(d.from);
      if (nextFrom !== undefined) d.from = nextFrom;
    }
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
