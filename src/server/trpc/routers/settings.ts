import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";

import { protectedProcedure, router } from "../init";

export const settingsRouter = router({
  /** 現在の設定値を返す (issue #36 / #37: 通知 on/off)。
   *  email が null (ADR-0006 で任意化、GitHub OAuth で email が取れなかった) の場合、
   *  Weekly Digest は実質的に送信できないので UI で disabled にするため `emailAvailable`
   *  を一緒に返す。 */
  get: protectedProcedure.query(({ ctx }) => ({
    weeklyDigestEnabled: ctx.user.weeklyDigestEnabled,
    webPushEnabled: ctx.user.webPushEnabled,
    emailAvailable: ctx.user.email !== null,
  })),

  /** Weekly Digest on/off (issue #36) */
  setWeeklyDigestEnabled: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      // email が無いユーザーに対して enabled=true を許すと「ON にしたのに届かない」
      // サイレント挙動になる (Codex PR#86 Round 1 指摘 #2)。server 側で弾いて UI に
      // 明示のエラーを返す。OFF はいつでも許可。
      if (input.enabled && ctx.user.email === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "email 未設定のため Weekly Digest を有効化できません",
        });
      }
      await getDb()
        .update(users)
        .set({ weeklyDigestEnabled: input.enabled })
        .where(eq(users.id, ctx.user.id));
      return { ok: true as const, enabled: input.enabled };
    }),
});
