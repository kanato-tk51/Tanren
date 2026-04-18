import { router } from "../init";
import { pingRouter } from "./ping";

export const appRouter = router({
  ping: pingRouter.ping,
});

export type AppRouter = typeof appRouter;
