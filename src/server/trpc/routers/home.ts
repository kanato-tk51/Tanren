import { fetchDailyProgress } from "@/server/home/daily-progress";

import { protectedProcedure, router } from "../init";

export const homeRouter = router({
  /** ホーム画面の「今日の進捗」(JST 00:00 以降の attempts 件数) を返す。 */
  dailyProgress: protectedProcedure.query(({ ctx }) => fetchDailyProgress({ userId: ctx.user.id })),
});
