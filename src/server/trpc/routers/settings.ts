import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";

import { protectedProcedure, router } from "../init";

export const settingsRouter = router({
  /** 現在の設定値を返す (issue #36 / #37: 通知 on/off) */
  get: protectedProcedure.query(({ ctx }) => ({
    weeklyDigestEnabled: ctx.user.weeklyDigestEnabled,
    webPushEnabled: ctx.user.webPushEnabled,
  })),

  /** Weekly Digest on/off (issue #36) */
  setWeeklyDigestEnabled: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(users)
        .set({ weeklyDigestEnabled: input.enabled })
        .where(eq(users.id, ctx.user.id));
      return { ok: true as const, enabled: input.enabled };
    }),
});
