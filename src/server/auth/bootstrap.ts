#!/usr/bin/env tsx
/**
 * 初回ユーザー作成用 CLI (ADR-0004)。
 *   pnpm auth:bootstrap <email> [displayName]
 *
 * 既に同 email のユーザーがいれば何もしない (idempotent)。
 * Passkey 登録自体はブラウザ UI から /api/auth/register/* を叩く想定。
 */
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";

async function main() {
  const [email, displayName] = process.argv.slice(2);
  if (!email) {
    console.error("usage: pnpm auth:bootstrap <email> [displayName]");
    process.exit(1);
  }

  const db = getDb();
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) {
    console.log(`✓ user already exists: ${existing[0].id} (${email})`);
    return;
  }

  const inserted = await db
    .insert(users)
    .values({ email, displayName: displayName ?? null })
    .returning();

  console.log(`✓ created user: ${inserted[0]?.id} (${email})`);
  console.log("  次に http://localhost:3000/login で Passkey を登録してください");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
