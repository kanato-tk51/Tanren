import { router } from "../init";
import { attemptsRouter } from "./attempts";
import { authRouter } from "./auth";
import { codeRouter } from "./code";
import { customRouter } from "./custom";
import { insightsRouter } from "./insights";
import { onboardingRouter } from "./onboarding";
import { pingRouter } from "./ping";
import { questionsRouter } from "./questions";
import { sessionRouter } from "./session";

export const appRouter = router({
  ping: pingRouter.ping,
  auth: authRouter,
  attempts: attemptsRouter,
  code: codeRouter,
  custom: customRouter,
  insights: insightsRouter,
  onboarding: onboardingRouter,
  questions: questionsRouter,
  session: sessionRouter,
});

export type AppRouter = typeof appRouter;
