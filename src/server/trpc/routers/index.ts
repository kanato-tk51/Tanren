import { router } from "../init";
import { authRouter } from "./auth";
import { pingRouter } from "./ping";
import { questionsRouter } from "./questions";
import { sessionRouter } from "./session";

export const appRouter = router({
  ping: pingRouter.ping,
  auth: authRouter,
  questions: questionsRouter,
  session: sessionRouter,
});

export type AppRouter = typeof appRouter;
