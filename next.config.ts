import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

// Sentry プラグインで build 時に sourcemap を Sentry にアップロード (issue #27)。
// SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT が未設定なら upload を skip するだけで
// build は壊れない (ローカル / preview の安全側 fallback)。
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  // sourcemap を public asset として残さない (本番 bundle に sourcemap URL を埋めない)
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
