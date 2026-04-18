import { router } from "../init";
import { authRouter } from "./auth";
import { pingRouter } from "./ping";
import { questionsRouter } from "./questions";

export const appRouter = router({
  ping: pingRouter.ping,
  auth: authRouter,
  questions: questionsRouter,
});

export type AppRouter = typeof appRouter;
