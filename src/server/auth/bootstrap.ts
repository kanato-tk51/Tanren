#!/usr/bin/env tsx
/**
 * 初回ユーザー作成用 CLI (ADR-0006)。
 *   pnpm auth:bootstrap <github_user_id> [displayName] [email]
 *
 * 動作:
 *   - 既に同じ github_user_id の行が存在 → 何もしない (idempotent)
 *   - email 引数が与えられ、その email を持つ既存行がある → その行に github_user_id /
 *     github_login(optional) を UPDATE (旧 Passkey からの移行ケースでデータを引き継ぐ
 *     ため、Codex PR#86 Round 1 指摘 #1)
 *   - どちらでもない → 新規 insert
 *
 * github_user_id は GITHUB_ALLOWED_USER_ID と一致させること (callback の allowlist 照合で
 * 拒否される)。
 */
import { eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";

async function main() {
  const [rawGithubId, displayName, email] = process.argv.slice(2);
  if (!rawGithubId) {
    console.error("usage: pnpm auth:bootstrap <github_user_id> [displayName] [email]");
    process.exit(1);
  }
  const githubUserId = Number(rawGithubId);
  if (!Number.isInteger(githubUserId) || githubUserId <= 0) {
    console.error("github_user_id must be a positive integer");
    process.exit(1);
  }
  const allowed = process.env.GITHUB_ALLOWED_USER_ID;
  if (allowed && Number(allowed) !== githubUserId) {
    // callback の allowlist と一致しない bootstrap はログイン不能な壊れた user 行を
    // 作るだけなので即時 fail-closed (Codex PR#86 Round 6 指摘 #1)。
    console.error(
      `error: GITHUB_ALLOWED_USER_ID=${allowed} と一致しません。OAuth callback で拒否されるため bootstrap を中止します。`,
    );
    process.exit(1);
  }

  const db = getDb();
  const byGithub = await db
    .select()
    .from(users)
    .where(eq(users.githubUserId, githubUserId))
    .limit(1);
  if (byGithub[0]) {
    console.log(`✓ user already linked: ${byGithub[0].id} (github id: ${githubUserId})`);
    return;
  }

  // 移行パス: email が指定されている場合、その email の既存行に github_user_id を紐付ける。
  // ADR-0004 (Passkey) 時代に作られた行は `email` に作者の email が入っているはずなので、
  // そこに github_user_id を書き戻すことで attempts / mastery / sessions_auth 等の関連
  // データを失わずに GitHub OAuth に切り替えられる。
  if (email) {
    const byEmail = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (byEmail[0]) {
      const updated = await db
        .update(users)
        .set({
          githubUserId,
          ...(displayName ? { displayName } : {}),
        })
        .where(eq(users.id, byEmail[0].id))
        .returning();
      console.log(
        `✓ linked existing user: ${updated[0]?.id} (email: ${email}, github id: ${githubUserId})`,
      );
      return;
    }
  }

  // 最後の保険: github_user_id が null かつ users が 1 件だけの場合、その行に紐付ける。
  // 移行前に email 以外の情報しか持っていない環境でのデータ引き継ぎを想定。
  const orphans = await db.select().from(users).where(isNull(users.githubUserId)).limit(2);
  if (orphans.length === 1 && !email) {
    const updated = await db
      .update(users)
      .set({
        githubUserId,
        ...(displayName ? { displayName } : {}),
      })
      .where(eq(users.id, orphans[0]!.id))
      .returning();
    console.log(`✓ linked single orphan user: ${updated[0]?.id} (github id: ${githubUserId})`);
    return;
  }

  const inserted = await db
    .insert(users)
    .values({
      githubUserId,
      displayName: displayName ?? null,
      email: email ?? null,
      // email が無いと Weekly Digest は実質送れないので、digest は OFF で作成する
      // (opt-in 扱い)。後で callback が email を補完しても、本人が意思決定せずに
      // 配信が始まるのを避ける (Codex PR#86 Round 2 指摘 #1)。
      weeklyDigestEnabled: Boolean(email),
    })
    .returning();

  console.log(`✓ created user: ${inserted[0]?.id} (github id: ${githubUserId})`);
  console.log("  次に http://localhost:3000/login で「GitHub でログイン」を押してください");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
