import { fetchInsightsOverview } from "@/server/insights/overview";

import { protectedProcedure, router } from "../init";

export const insightsRouter = router({
  /**
   * Insights Dashboard の overview (issue #20, docs/05 §5.3)。
   * mastery 全体、top3 strongest / weakest / blindSpots / decaying を返す。
   */
  overview: protectedProcedure.query(({ ctx }) => fetchInsightsOverview(ctx.user.id)),
});
