import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { pushSubscriptions, users } from "@/db/schema";

import { protectedProcedure, router } from "../init";

/** Web Push subscription 登録 / 解除 (issue #37) */
export const pushRouter = router({
  /** Service Worker 登録 → navigator.pushManager.subscribe() の結果を DB に upsert。
   *  既存 endpoint が別ユーザー所有なら FORBIDDEN で弾く (乗っ取り防止、Codex Round 1 指摘 #1)。
   *  web_push_enabled は自動で切り替えない。UI 側が明示的に setEnabled を呼ぶ
   *  (Codex Round 1 指摘 #3: 購読と配信設定の責務分離)。
   */
  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url().min(1),
        p256dh: z.string().min(1),
        auth: z.string().min(1),
        userAgent: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db
        .select({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint))
        .limit(1);
      if (existing[0] && existing[0].userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "別ユーザーが所有する endpoint です",
        });
      }
      // 同一ユーザーが再 subscribe した or 初回: 鍵だけ upsert する。conflict 時に userId は触らない。
      await db
        .insert(pushSubscriptions)
        .values({
          userId: ctx.user.id,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent ?? null,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent ?? null,
          },
        });
      return { ok: true as const };
    }),

  /** 明示的な unsubscribe (endpoint 単位、設定フラグは最後の 1 件削除で OFF にする) */
  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpoint, input.endpoint),
            eq(pushSubscriptions.userId, ctx.user.id),
          ),
        );
      const remaining = await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, ctx.user.id))
        .limit(1);
      if (remaining.length === 0) {
        await db.update(users).set({ webPushEnabled: false }).where(eq(users.id, ctx.user.id));
      }
      return { ok: true as const };
    }),

  /** Web Push 機能全体の on/off (subscription を消すわけではない、送信 gate だけ切る) */
  setEnabled: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(users)
        .set({ webPushEnabled: input.enabled })
        .where(eq(users.id, ctx.user.id));
      return { ok: true as const, enabled: input.enabled };
    }),

  /** UI が public key を取得するための endpoint (client bundle に直接埋めない設計) */
  getPublicKey: protectedProcedure.query(() => {
    const pk = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? null;
    if (!pk) throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "VAPID public key unset" });
    return { publicKey: pk };
  }),
});
