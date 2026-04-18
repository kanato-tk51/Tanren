import { z } from "zod";

import { DOMAIN_IDS } from "@/db/schema/_constants";
import { fetchHistory } from "@/server/insights/history";
import { fetchInsightsOverview } from "@/server/insights/overview";

import { protectedProcedure, router } from "../init";

export const insightsRouter = router({
  /**
   * Insights Dashboard の overview (issue #20, docs/05 §5.3)。
   * mastery 全体、top3 strongest / weakest / blindSpots / decaying を返す。
   */
  overview: protectedProcedure.query(({ ctx }) => fetchInsightsOverview(ctx.user.id)),

  /**
   * History 画面 (issue #21, docs/05 §5.5)。
   * cursor ベース pagination。フィルタは分野 / 正誤 / 期間。
   */
  history: protectedProcedure
    .input(
      z.object({
        period: z.enum(["all", "today", "week"]).optional(),
        correctness: z.enum(["all", "correct", "wrong"]).optional(),
        domains: z.array(z.enum(DOMAIN_IDS)).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(({ ctx, input }) => fetchHistory({ userId: ctx.user.id, filter: input })),
});
