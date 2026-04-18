/* Sentry client init (issue #27)。
 *
 * 注意:
 *   - Next.js 15 推奨の `instrumentation-client.ts` 命名に将来切り替え予定。現在は
 *     `@sentry/nextjs` 10.x の docs どおり sentry.client.config.ts を root に置く。
 *   - SENTRY_DSN が未設定なら early return で完全 no-op (ローカル / preview の事故防止)。
 *   - tracesSampleRate は MVP で 0.1 (= 10%) に絞る。Sentry Free tier の枠を尊重する。
 */
import * as Sentry from "@sentry/nextjs";

import { tanrenBeforeSend } from "@/lib/sentry/before-send";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    // session replay は MVP で off (PII 流出リスク + Free tier 枠)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // sendDefaultPii: false で email / ip 等の自動収集を抑止 (beforeSend と二重防御)
    sendDefaultPii: false,
    beforeSend: tanrenBeforeSend,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  });
}
