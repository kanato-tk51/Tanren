import { initTRPC, TRPCError } from "@trpc/server";

import type { User } from "@/db/schema";

/**
 * tRPC 用のリクエストコンテキスト。
 * 認証は issue #6 で実装するため、ここでは `user` 欄のみ定義して
 * 中身は空 (anonymous) で埋める。
 */
export type TrpcContext = {
  user: User | null;
};

export async function createTrpcContext(): Promise<TrpcContext> {
  return { user: null };
}

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * protected procedure のスタブ。
 * Passkey 認証 (issue #6) が入るまでは常に UNAUTHORIZED を返し、
 * ダウンストリームが「ここで cookie → user が注入される」前提で書ける。
 */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Passkey auth is not yet wired (issue #6)",
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
