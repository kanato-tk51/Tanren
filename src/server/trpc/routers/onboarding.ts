import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { DIFFICULTY_LEVELS, TIER_1_DOMAIN_IDS, users } from "@/db/schema";

import { protectedProcedure, router } from "../init";

const InterestDomainsSchema = z
  .array(z.enum(TIER_1_DOMAIN_IDS))
  .min(1, "興味分野を 1 つ以上選んでください")
  .max(TIER_1_DOMAIN_IDS.length);

// 自己申告レベルは MVP の Tier 1 用途で beginner..senior に絞る (docs/07.11)。
// staff / principal は申告できても今 seed の concept レンジが mid 中心で当たりが
// ほぼ 0 件になるため、診断テストが成立しない。
const SelfLevelSchema = z.enum(["beginner", "junior", "mid", "senior"] as const);

export const onboardingRouter = router({
  /** /onboarding ページや / 側で「リダイレクトすべきか」を判定するための最小情報 */
  getStatus: protectedProcedure.query(({ ctx }) => {
    const u = ctx.user;
    return {
      completed: u.onboardingCompletedAt !== null,
      interestDomains: (u.interestDomains ?? []) as (typeof TIER_1_DOMAIN_IDS)[number][],
      selfLevel: (u.selfLevel ?? null) as z.infer<typeof SelfLevelSchema> | null,
    };
  }),

  /** 興味分野 + 自己申告レベルを保存。診断 session の起動は session.start({ kind:'diagnostic' }) */
  savePreferences: protectedProcedure
    .input(
      z.object({
        interestDomains: InterestDomainsSchema,
        selfLevel: SelfLevelSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(users)
        .set({
          interestDomains: input.interestDomains,
          selfLevel: input.selfLevel,
        })
        .where(eq(users.id, ctx.user.id));
      return { ok: true as const };
    }),

  /** 診断テスト完了後に呼ぶ。onboarding_completed_at を NOW() に更新 */
  complete: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.user.interestDomains || ctx.user.interestDomains.length === 0 || !ctx.user.selfLevel) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "興味分野と自己申告レベルが未設定です",
      });
    }
    await getDb()
      .update(users)
      .set({ onboardingCompletedAt: new Date() })
      .where(eq(users.id, ctx.user.id));
    return { ok: true as const };
  }),
});

export const ONBOARDING_DIFFICULTY_LEVELS =
  SelfLevelSchema.options satisfies readonly (typeof DIFFICULTY_LEVELS)[number][];
