import { z } from "zod";

import { parseCustomSession } from "@/server/parser/custom-session";

import { protectedProcedure, router } from "../init";

export const customRouter = router({
  /**
   * 自然言語のリクエストを CustomSessionSpec にパースする (issue #17)。
   * LLM 呼び出しは `src/server/parser/custom-session.ts` の gpt-5-mini。
   */
  parse: protectedProcedure
    .input(z.object({ raw: z.string().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      const { spec, promptVersion, model } = await parseCustomSession(input.raw);
      return { spec, promptVersion, model };
    }),
});
