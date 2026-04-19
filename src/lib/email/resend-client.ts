import "server-only";

import { Resend } from "resend";

/** Resend クライアントのシングルトン (issue #36)。
 *  RESEND_API_KEY 未設定なら null (メール送信は no-op)。
 */
let cached: Resend | null | undefined;

export function getResend(): Resend | null {
  if (cached !== undefined) return cached;
  const key = process.env.RESEND_API_KEY;
  cached = key ? new Resend(key) : null;
  return cached;
}

/** `from` アドレス (RESEND_FROM_EMAIL 未設定なら null = 送信不可) */
export function resendFromEmail(): string | null {
  return process.env.RESEND_FROM_EMAIL ?? null;
}
