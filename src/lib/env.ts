/**
 * ランタイムで取り出す env 変数をここに集約。
 * - Production/Development は Vercel の Environment Variables から注入
 * - Preview は VERCEL_URL で動的に組み立てる値 (WEBAUTHN_* / APP_URL) があるので工夫が必要
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is not set`);
  }
  return value;
}

/** 空文字も未定義扱いにする (Vercel 側で空値が入ることがあるため) */
function nonEmpty(v: string | undefined): string | undefined {
  return v && v.length > 0 ? v : undefined;
}

/** Preview では VERCEL_URL 由来にフォールバック */
export const appUrl =
  nonEmpty(process.env.NEXT_PUBLIC_APP_URL) ??
  (nonEmpty(process.env.VERCEL_URL)
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

/** Passkey が有効かどうか (Preview などで WEBAUTHN_RP_ID 未設定なら false) */
export const passkeyEnabled = Boolean(process.env.WEBAUTHN_RP_ID);

export const env = {
  appUrl,
  passkeyEnabled,
  webauthn: {
    rpId: process.env.WEBAUTHN_RP_ID,
    rpName: process.env.WEBAUTHN_RP_NAME ?? "Tanren",
    origin: process.env.WEBAUTHN_ORIGIN ?? appUrl,
  },
  openaiApiKey: () => required("OPENAI_API_KEY"),
  databaseUrl: () => required("DATABASE_URL"),
  sessionCookieSecret: () => required("SESSION_COOKIE_SECRET"),
} as const;
