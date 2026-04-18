import { z } from "zod";

import { parseCustomSession } from "@/server/parser/custom-session";

import { protectedProcedure, router } from "../init";

export const customRouter = router({
  /**
   * 自然言語のリクエストを CustomSessionSpec にパースする (issue #17)。
   * LLM 呼び出しは `src/server/parser/custom-session.ts` の gpt-5-mini。
   */
  parse: protectedProcedure
    .input(
      z.object({
        // 先に trim してから min/max を効かせる (末尾空白で max を誤発火させないため)。
        // min(1) で whitespace-only を reject、max(2000) は LLM コンテキスト保護。
        raw: z
          .string()
          .transform((s) => s.trim())
          .pipe(z.string().min(1, "空の入力は parse できません").max(2000)),
      }),
    )
    .mutation(async ({ input }) => {
      const { spec, promptVersion, model } = await parseCustomSession(input.raw);
      return { spec, promptVersion, model };
    }),
});
