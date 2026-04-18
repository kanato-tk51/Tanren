import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";

import { isPasskeyEnabled } from "./webauthn";

/**
 * Passkey を使えない環境 (Preview で RP_ID 未設定など) で「作者 1 名」の個人プロダクトとして動かすための fallback。
 * 既に users テーブルにユーザーが 1 名だけ存在する場合にそれを返す。
 * 複数ユーザー時や passkey が有効な場合は必ず false を返して、通常の auth フローに委ねる。
 */
export async function tryDevAutoLoginUser() {
  if (isPasskeyEnabled()) return null;
  const rows = await getDb().select().from(users).limit(2);
  if (rows.length !== 1) return null;
  return rows[0];
}

/** dev モードで特定 email の user を取得するヘルパ。存在しなければ null */
export async function findUserByEmail(email: string) {
  const rows = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}
