import { isPasskeyEnabled } from "./webauthn";

/**
 * Dev ショートカット (`/api/auth/dev-login`) が利用可能な環境か判定。
 * UI とサーバー Route Handler の両方から呼び出すことで判定を 1 箇所に集約する。
 *
 * 許可されるのは以下のいずれか:
 * - NODE_ENV が "development" or "test" (ローカル `next dev` や vitest)
 * - VERCEL_ENV が "preview" or "development" (Vercel の非本番)
 *
 * かつ:
 * - Passkey が無効 (WEBAUTHN_RP_ID 未設定) であること
 *
 * `next start` 的な self-hosted 本番 (NODE_ENV=production かつ VERCEL_ENV 未設定) は
 * 明示的に遮断する (認証バイパス防止)。
 */
export function isDevShortcutAvailable(): boolean {
  if (isPasskeyEnabled()) return false;

  const vercelEnv = process.env.VERCEL_ENV;
  const nodeEnv = process.env.NODE_ENV;

  if (vercelEnv === "production") return false;
  if (vercelEnv === "preview" || vercelEnv === "development") return true;
  // VERCEL_ENV が立っていない場合 (ローカル / self-host) は NODE_ENV のみで判断
  return nodeEnv !== "production";
}

/**
 * ローカル開発時 (pnpm dev / vercel dev / next dev) の認証丸ごとバイパス。
 * GitHub OAuth 移行 (issue #71) 完了までの暫定処置として、
 * `NODE_ENV === "development"` かつ `VERCEL_ENV` が preview/production でない時のみ有効化する。
 * Passkey 有効・無効と独立に働く点で `isDevShortcutAvailable` と異なる。
 *
 * preview / production では絶対に有効化してはいけない (認証バイパスになる)。
 */
export function isLocalAuthBypassEnabled(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production" || vercelEnv === "preview") return false;
  return process.env.NODE_ENV === "development";
}
