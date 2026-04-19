/** 認証まわりの定数 (ADR-0006)。Passkey 時代の命名 `__Host-tanren_session` は
 *  後方互換のためそのまま維持する (既存 session 行を無効化しないため)。 */

export const SESSION_COOKIE_NAME = "__Host-tanren_session";
/** dev ショートカット用の cookie 名は ADR-0006 で廃止したが、既存コードとの
 *  互換のために定数は残す (将来のリファクタで消去予定)。 */
export const DEV_SESSION_COOKIE_NAME = "tanren_dev_session";

/** 30 日 sliding expiry */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** GitHub OAuth の state + code_verifier を保持する短命 cookie 名 (ADR-0006)。 */
export const OAUTH_STATE_COOKIE_NAME = "__Host-tanren_oauth_state";

/** OAuth フロー中の state / code_verifier 有効期間 */
export const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
