import { randomUUID } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { cookies } from "next/headers";
import { cache } from "react";

import { getDb } from "@/db/client";
import { sessionsAuth, users, type User } from "@/db/schema";

import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from "./constants";

export type CookieStore = ReadonlyRequestCookies | Awaited<ReturnType<typeof cookies>>;

type SessionResolution = {
  user: User;
  sessionId: string;
  /** resolve 時に延長された expiresAt。cookie の再発行に使う */
  expiresAt: Date;
};

/** `sessions_auth` に新しい行を作り、cookie attribute を返す */
export async function createSession(userId: string): Promise<{
  sessionId: string;
  expiresAt: Date;
  cookie: Omit<ResponseCookie, "value" | "name">;
}> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

  await getDb().insert(sessionsAuth).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  return {
    sessionId,
    expiresAt,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    },
  };
}

/**
 * cookie 経由で session を取得。30 日 sliding expiry の更新も担当。
 * ADR-0006 以降は GitHub OAuth の `__Host-tanren_session` cookie 1 本のみを見る。
 * 呼び出し元は返却された `expiresAt` を使って cookie を再発行すること。
 */
export async function resolveSession(store: CookieStore): Promise<SessionResolution | null> {
  const sessionId = store.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (!sessionId) return null;

  const db = getDb();
  const rows = await db
    .select({ session: sessionsAuth, user: users })
    .from(sessionsAuth)
    .innerJoin(users, eq(users.id, sessionsAuth.userId))
    .where(and(eq(sessionsAuth.id, sessionId), gt(sessionsAuth.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // 30 日 sliding: アクセス毎に expiresAt を押し出し、cookie も後続で同期延長する
  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);
  await db
    .update(sessionsAuth)
    .set({ lastActiveAt: now, expiresAt: newExpiresAt })
    .where(eq(sessionsAuth.id, sessionId));

  return { user: row.user, sessionId, expiresAt: newExpiresAt };
}

/** cookie の破棄とテーブル削除 */
export async function destroySession(sessionId: string): Promise<void> {
  await getDb().delete(sessionsAuth).where(eq(sessionsAuth.id, sessionId));
}

/**
 * 既存セッションの cookie を延長された expiresAt で再発行する共通ヘルパ。
 * tRPC context / Route Handler どちらからも呼べるよう、`store.set` が不可な文脈では
 * 例外を握りつぶす (DB 側は既に延長済みなので整合は保たれる)。
 */
export function refreshSessionCookie(
  store: CookieStore,
  resolution: Pick<SessionResolution, "sessionId" | "expiresAt">,
): void {
  try {
    store.set({
      name: SESSION_COOKIE_NAME,
      value: resolution.sessionId,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: resolution.expiresAt,
    });
  } catch {
    // Server Component など store.set が呼べない文脈では DB 側の延長で十分 (cookie は
    // 次回ミドルウェア / Route Handler 経由で再発行される)
  }
}

/** Route Handler 内で使うヘルパ。sliding expiry の cookie 再発行も同時に行う。
 *  同一 request 内の複数呼び出しは React.cache で dedup (nested layout + page で
 *  両方呼ぶケースで DB round-trip が 2 回走るのを防ぐ、PR#84 Codex Round 5 由来)。 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const store = await cookies();
  const resolved = await resolveSession(store);
  if (!resolved) return null;
  refreshSessionCookie(store, resolved);
  return resolved.user;
});
