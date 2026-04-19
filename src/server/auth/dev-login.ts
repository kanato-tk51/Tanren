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
 *
 * users.email は unique 制約付きなので、初回並列リクエストでの race は
 * `onConflictDoNothing` + 再読込で吸収する (losing race 側は再 select で勝者の行を拾う)。
 */
export async function ensureLocalDevUser(): Promise<User> {
  const existing = await findUserByEmail(LOCAL_DEV_USER_EMAIL);
  if (existing) return existing;

  const inserted = await getDb()
    .insert(users)
    .values({
      email: LOCAL_DEV_USER_EMAIL,
      displayName: "Local Dev",
      onboardingCompletedAt: new Date(),
      interestDomains: [...TIER_1_DOMAIN_IDS],
      selfLevel: "mid",
    })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (inserted[0]) return inserted[0];

  // 並列 insert で負けた側は row が返らないので勝者の行を再読込する。
  const refetched = await findUserByEmail(LOCAL_DEV_USER_EMAIL);
  if (!refetched) {
    throw new Error("failed to ensure local dev user: race lost and row still missing");
  }
  return refetched;
}
