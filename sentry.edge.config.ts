/* Sentry edge init (issue #27)。
 *
 * Routing Middleware など edge runtime 上の例外を捕捉する。
 * Tanren MVP は middleware を使っていないが、@sentry/nextjs の hooks 配置に従い空 init を置く
 * (将来 middleware を追加した時に有効化される設計)。SENTRY_DSN 未設定時は no-op。
 */
import * as Sentry from "@sentry/nextjs";

import { tanrenBeforeSend } from "@/lib/sentry/before-send";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: tanrenBeforeSend,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  });
}
