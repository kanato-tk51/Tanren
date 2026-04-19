/** OAuth flow から `/login?error=<code>` に載せるエラーコード列挙 (ADR-0006)。
 *  route と UI の両方で参照するため、shared constants に集約する
 *  (Codex PR#86 Round 5 指摘 #2)。UI の日本語メッセージは `login-form.tsx` 側に置く。 */

export const OAUTH_ERROR_CODES = [
  "invalid_request",
  "state_expired",
  "state_mismatch",
  "server_misconfigured",
  "token_exchange_failed",
  "user_fetch_failed",
  "forbidden",
  "not_bootstrapped",
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];
