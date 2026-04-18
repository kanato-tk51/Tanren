import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createTrpcContext } from "@/server/trpc/init";
import { appRouter } from "@/server/trpc/routers";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTrpcContext(),
    onError({ error, path }) {
      if (process.env.NODE_ENV !== "production") {
        console.error(`[tRPC] ${path ?? "<no-path>"}: ${error.message}`);
      }
    },
  });

export { handler as GET, handler as POST };
