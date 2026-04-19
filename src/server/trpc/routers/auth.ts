import { publicProcedure, router } from "../init";

/**
 * 現在のセッション情報。UI が「ログイン済みか」を判定するための最小限。
 */
export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return { authenticated: false as const };
    return {
      authenticated: true as const,
      user: {
        id: ctx.user.id,
        email: ctx.user.email,
        displayName: ctx.user.displayName,
        githubLogin: ctx.user.githubLogin,
        dailyGoal: ctx.user.dailyGoal,
      },
    };
  }),
});
