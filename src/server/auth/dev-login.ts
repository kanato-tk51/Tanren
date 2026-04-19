import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { TIER_1_DOMAIN_IDS } from "@/db/schema/_constants";
import { users, type User } from "@/db/schema";

import { isPasskeyEnabled } from "./webauthn";

/** ローカル bypass 用の固定 user (isLocalAuthBypassEnabled=true 時のみ発行) */
export const LOCAL_DEV_USER_EMAIL = "dev@local.tanren";

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

/**
 * ローカル bypass 用の dev user を idempotent に確保する。
 * onboarding 完了済みで作成して /onboarding への強制リダイレクトを回避。
 * 興味分野は Tier 1 全ドメイン、self_level は "mid"。
 */
export async function ensureLocalDevUser(): Promise<User> {
  const db = getDb();
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, LOCAL_DEV_USER_EMAIL))
    .limit(1);
  if (existing[0]) return existing[0];

  const [inserted] = await db
    .insert(users)
    .values({
      email: LOCAL_DEV_USER_EMAIL,
      displayName: "Local Dev",
      onboardingCompletedAt: new Date(),
      interestDomains: [...TIER_1_DOMAIN_IDS],
      selfLevel: "mid",
    })
    .returning();
  if (!inserted) {
    throw new Error("failed to create local dev user");
  }
  return inserted;
}
