import { initTRPC, TRPCError } from "@trpc/server";
import { cookies } from "next/headers";

import type { User } from "@/db/schema";
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
    return { user: resolved?.user ?? null };
  } catch {
    // cookies() は Server Action や一部 edge ランタイムで使えないケースがある。
    // その場合は未ログイン扱いにフォールバックして呼び出し元に委ねる。
    return { user: null };
  }
}

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * 認証必須の procedure。
 * `createTrpcContext` で cookie 由来の user が ctx に入る前提で、未ログインなら UNAUTHORIZED。
 */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not signed in" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
