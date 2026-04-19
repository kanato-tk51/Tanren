import { randomUUID } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { cookies } from "next/headers";

import { getDb } from "@/db/client";
import { sessionsAuth, users, type User } from "@/db/schema";

import { isDevShortcutAvailable, isLocalAuthBypassEnabled } from "./capabilities";
import {
  DEV_SESSION_COOKIE_NAME,
  LOCAL_BYPASS_OFF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
} from "./constants";
import { ensureLocalDevUser } from "./dev-login";

export type CookieStore = ReadonlyRequestCookies | Awaited<ReturnType<typeof cookies>>;

type SessionResolution = {
  user: User;
  sessionId: string;
  /** resolve 時に延長された expiresAt。cookie の再発行に使う */
  expiresAt: Date;
  /**
   * - `passkey`: __Host- cookie 経由の Passkey セッション
   * - `dev`: dev ショートカット由来の non-__Host- cookie セッション
   * - `bypass`: ローカル bypass (issue #71 着地までの暫定、cookie なし)
   */
  kind: "passkey" | "dev" | "bypass";
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
  // 1. 実 session cookie を最優先で解決する。これで logout → 再ログインや sessions_auth の
  //    後片付けが bypass に巻き込まれずに動く (Codex review Round 2 指摘)。
  const passkeyId = store.get(SESSION_COOKIE_NAME)?.value ?? null;
  // dev cookie は「dev ショートカットが許可された環境」でのみ受理する。
  // pre-production で発行された cookie を self-host 本番に持ち込まれるバイパス対策。
  const devId = isDevShortcutAvailable()
    ? (store.get(DEV_SESSION_COOKIE_NAME)?.value ?? null)
    : null;
  const sessionId = passkeyId ?? devId;

  if (sessionId) {
    const kind: "passkey" | "dev" = passkeyId ? "passkey" : "dev";

    const db = getDb();
    const rows = await db
      .select({ session: sessionsAuth, user: users })
      .from(sessionsAuth)
      .innerJoin(users, eq(users.id, sessionsAuth.userId))
      .where(and(eq(sessionsAuth.id, sessionId), gt(sessionsAuth.expiresAt, new Date())))
      .limit(1);

    const row = rows[0];
    // cookie はあるが session 行が見つからない / 期限切れの場合は null。bypass で救済しない
    // (再ログインを促す。誤爆での自動 bypass で足元を見失わないため)。
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

  // 2. 実 cookie が無いときだけローカル bypass を検討する (issue #71 着地までの暫定)。
  //    preview / production では isLocalAuthBypassEnabled が必ず false になり到達しない。
  //    `/api/auth/logout` が立てた opt-out cookie がある間は bypass を skip し、
  //    「ログアウト直後は未認証状態でいられる」体験を保つ。
  if (isLocalAuthBypassEnabled() && !store.get(LOCAL_BYPASS_OFF_COOKIE_NAME)?.value) {
    const user = await ensureLocalDevUser();
    return {
      user,
      sessionId: "local-dev-bypass",
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS),
      kind: "bypass",
    };
  }

  return null;
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
  resolution: Pick<SessionResolution, "sessionId" | "expiresAt" | "kind">,
): void {
  // bypass 由来は cookie を持たない (DB にも sessions_auth 行が無い)。書き込まない。
  if (resolution.kind === "bypass") return;
  try {
    if (resolution.kind === "passkey") {
      store.set({
        name: SESSION_COOKIE_NAME,
        value: resolution.sessionId,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        expires: resolution.expiresAt,
      });
    } else {
      store.set({
        name: DEV_SESSION_COOKIE_NAME,
        value: resolution.sessionId,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        expires: resolution.expiresAt,
        secure: process.env.NODE_ENV === "production",
      });
    }
  } catch {
    // Server Component など store.set が呼べない文脈では DB 側の延長で十分 (cookie は
    // 次回ミドルウェア / Route Handler 経由で再発行される)
  }
}

/** Route Handler 内で使うヘルパ。sliding expiry の cookie 再発行も同時に行う */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const resolved = await resolveSession(store);
  if (!resolved) return null;
  refreshSessionCookie(store, resolved);
  return resolved.user;
}
