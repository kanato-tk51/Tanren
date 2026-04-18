/* Next.js instrumentation hook (issue #27)。
 *
 * `next.config.ts` の experimental.instrumentationHook が無くても Next.js 15 では
 * root の instrumentation.ts が自動 detect される。
 * @sentry/nextjs はこの register() で server / edge config をロードする。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Next.js 15 の `instrumentation.ts` から export して Server Components / Route Handlers
// で発生した未捕捉エラーを Sentry に流す。@sentry/nextjs 10.x では captureRequestError
// 名でエクスポートされている (旧 onRequestError とは別名)。
export { captureRequestError as onRequestError } from "@sentry/nextjs";
