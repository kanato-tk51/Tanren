#!/usr/bin/env tsx
/**
 * 初回ユーザー作成用 CLI (ADR-0006)。
 *   pnpm auth:bootstrap <github_user_id> [displayName] [email]
 *
 * 既に同 github_user_id のユーザーがいれば何もしない (idempotent)。
 * OAuth 完了後 `findUserByGithubId` が非 null を返すよう、initial row を作成する。
 * github_user_id は GITHUB_ALLOWED_USER_ID と一致させること (照合で拒否される)。
 */
import { eq } from "drizzle-orm";

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
    console.error(
      `warning: GITHUB_ALLOWED_USER_ID=${allowed} と一致しません。OAuth 照合で拒否される可能性があります。`,
    );
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.githubUserId, githubUserId))
    .limit(1);
  if (existing[0]) {
    console.log(`✓ user already exists: ${existing[0].id} (github id: ${githubUserId})`);
    return;
  }

  const inserted = await db
    .insert(users)
    .values({
      githubUserId,
      displayName: displayName ?? null,
      email: email ?? null,
    })
    .returning();

  console.log(`✓ created user: ${inserted[0]?.id} (github id: ${githubUserId})`);
  console.log("  次に http://localhost:3000/login で「GitHub でログイン」を押してください");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
