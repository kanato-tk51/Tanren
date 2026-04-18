import { initTRPC, TRPCError } from "@trpc/server";
import { cookies } from "next/headers";

import type { User } from "@/db/schema";
import { DEV_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/server/auth/constants";
import { resolveSession } from "@/server/auth/session";

/**
 * tRPC 用のリクエストコンテキスト。cookie → sessions_auth → users の解決結果を `user` に入れる。
 */
export type TrpcContext = {
  user: User | null;
};

export async function createTrpcContext(): Promise<TrpcContext> {
  try {
    const store = await cookies();
    const resolved = await resolveSession(store);
    if (!resolved) return { user: null };

    // 30 日 sliding: 延長された expiresAt で cookie を再発行 (失敗は握りつぶす)
    try {
      if (resolved.kind === "passkey") {
        store.set({
          name: SESSION_COOKIE_NAME,
          value: resolved.sessionId,
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          expires: resolved.expiresAt,
        });
      } else {
        store.set({
          name: DEV_SESSION_COOKIE_NAME,
          value: resolved.sessionId,
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          expires: resolved.expiresAt,
          secure: process.env.NODE_ENV === "production",
        });
      }
    } catch {
      // Server Component から呼ばれた場合など store.set が不可のケース。DB 側は既に延長済み
    }

    return { user: resolved.user };
  } catch {
    return { user: null };
  }
}

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * 認証必須の procedure。`createTrpcContext` で cookie 由来の user が入る前提で
 * 未ログインなら UNAUTHORIZED。
 */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not signed in" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
