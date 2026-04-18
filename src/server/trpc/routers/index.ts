import { router } from "../init";
import { authRouter } from "./auth";
import { pingRouter } from "./ping";

export const appRouter = router({
  ping: pingRouter.ping,
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
