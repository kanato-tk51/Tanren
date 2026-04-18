import { router } from "../init";
import { attemptsRouter } from "./attempts";
import { authRouter } from "./auth";
import { customRouter } from "./custom";
import { pingRouter } from "./ping";
import { questionsRouter } from "./questions";
import { sessionRouter } from "./session";

export const appRouter = router({
  ping: pingRouter.ping,
  auth: authRouter,
  attempts: attemptsRouter,
  custom: customRouter,
  questions: questionsRouter,
  session: sessionRouter,
});

export type AppRouter = typeof appRouter;
