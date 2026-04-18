/* Sentry server init (issue #27)。
 *
 * Next.js 15 の Node.js runtime (App Router の Server Components, Route Handlers,
 * Server Actions, fluid compute) で発生した例外を捕捉する。
 * SENTRY_DSN が未設定なら early return で no-op。
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
