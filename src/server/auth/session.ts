import { randomUUID } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { cookies } from "next/headers";

import { getDb } from "@/db/client";
import { sessionsAuth, users, type User } from "@/db/schema";

import { DEV_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from "./constants";

type CookieStore = ReadonlyRequestCookies | Awaited<ReturnType<typeof cookies>>;

type SessionResolution = {
  user: User;
  sessionId: string;
};

/** `sessions_auth` に新しい行を作り、cookie attribute を返す */
export async function createSession(userId: string): Promise<{
  sessionId: string;
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
 * cookie 経由で session を取得。sliding expiry 更新も担当。
 * Passkey (__Host-) と dev ショートカット両方をチェックする。
 */
export async function resolveSession(store: CookieStore): Promise<SessionResolution | null> {
  const sessionId =
    store.get(SESSION_COOKIE_NAME)?.value ?? store.get(DEV_SESSION_COOKIE_NAME)?.value ?? null;

  if (!sessionId) return null;

  const db = getDb();
  const rows = await db
    .select({
      session: sessionsAuth,
      user: users,
    })
    .from(sessionsAuth)
    .innerJoin(users, eq(users.id, sessionsAuth.userId))
    .where(and(eq(sessionsAuth.id, sessionId), gt(sessionsAuth.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Sliding expiry: last_active_at を更新 (expires_at は既に先にしか進めない設計)
  await db
    .update(sessionsAuth)
    .set({ lastActiveAt: new Date() })
    .where(eq(sessionsAuth.id, sessionId));

  return { user: row.user, sessionId };
}

/** cookie の破棄とテーブル削除 */
export async function destroySession(sessionId: string): Promise<void> {
  await getDb().delete(sessionsAuth).where(eq(sessionsAuth.id, sessionId));
}

/** Route Handler 内で使うヘルパ */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const resolved = await resolveSession(store);
  return resolved?.user ?? null;
}
