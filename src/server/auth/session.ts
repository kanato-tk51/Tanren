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
  /** resolve 時に延長された expiresAt。cookie の再発行に使う */
  expiresAt: Date;
  /** dev (non __Host-) セッションか、Passkey (__Host-) セッションか */
  kind: "passkey" | "dev";
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
 * Passkey (__Host-) と dev ショートカット両方をチェック。
 * 呼び出し元は返却された `expiresAt` を使って cookie を再発行すること。
 */
export async function resolveSession(store: CookieStore): Promise<SessionResolution | null> {
  const passkeyId = store.get(SESSION_COOKIE_NAME)?.value ?? null;
  const devId = store.get(DEV_SESSION_COOKIE_NAME)?.value ?? null;
  const sessionId = passkeyId ?? devId;
  if (!sessionId) return null;
  const kind: "passkey" | "dev" = passkeyId ? "passkey" : "dev";

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

  return { user: row.user, sessionId, expiresAt: newExpiresAt, kind };
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
