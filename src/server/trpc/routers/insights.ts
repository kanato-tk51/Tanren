import { z } from "zod";

import { DOMAIN_IDS } from "@/db/schema/_constants";
import { fetchHistory } from "@/server/insights/history";
import { fetchMasteryMap } from "@/server/insights/mastery-map";
import { fetchInsightsOverview } from "@/server/insights/overview";
import { fetchSearch } from "@/server/insights/search";

import { protectedProcedure, router } from "../init";

export const insightsRouter = router({
  /**
   * Insights Dashboard の overview (issue #20, docs/05 §5.3)。
   * mastery 全体、top3 strongest / weakest / blindSpots / decaying を返す。
   */
  overview: protectedProcedure.query(({ ctx }) => fetchInsightsOverview(ctx.user.id)),

  /**
   * Mastery Map (issue #29, docs/05 §5.4)。
   * 全 concept を domain → subdomain → concept の 3 階層で返す (サンバースト用)。
   */
  masteryMap: protectedProcedure.query(({ ctx }) => fetchMasteryMap(ctx.user.id)),

  /**
   * History 画面 (issue #21, docs/05 §5.5)。
   * cursor ベース pagination。フィルタは分野 / 正誤 / 期間。
   */
  history: protectedProcedure
    .input(
      z.object({
        period: z.enum(["all", "today", "week"]).optional(),
        correctness: z.enum(["all", "correct", "partial", "wrong"]).optional(),
        domains: z.array(z.enum(DOMAIN_IDS)).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(({ ctx, input }) => fetchHistory({ userId: ctx.user.id, filter: input })),

  /**
   * 簡易全文検索 (issue #22, docs/05 §5.6)。
   * ILIKE '%q%' ベース。tsvector 本格チューニングは Phase 5+ (issue #30)。
   */
  search: protectedProcedure
    .input(
      z.object({
        q: z
          .string()
          .transform((s) => s.trim())
          .pipe(z.string().min(1, "検索語を入力してください").max(200)),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      fetchSearch({ userId: ctx.user.id, q: input.q, limit: input.limit }),
    ),
});
