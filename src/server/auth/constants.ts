/** WebAuthn / セッション運用の定数 (ADR-0004 §6.8.1) */

export const SESSION_COOKIE_NAME = "__Host-tanren_session";
/** dev ショートカット用の cookie。passkey 無効 Preview などで使用 */
export const DEV_SESSION_COOKIE_NAME = "tanren_dev_session";

/** 30 日 sliding expiry */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** WebAuthn チャレンジ有効期間 (登録・認証とも短め) */
export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
