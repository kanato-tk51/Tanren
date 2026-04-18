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
        // 空白だけの入力を受理しないよう trim() 後に min(1) を効かせる。
        // max は 2000 字 (LLM コンテキストを圧迫しない上限)。
        raw: z
          .string()
          .max(2000)
          .transform((s) => s.trim())
          .pipe(z.string().min(1, "空の入力は parse できません")),
      }),
    )
    .mutation(async ({ input }) => {
      const { spec, promptVersion, model } = await parseCustomSession(input.raw);
      return { spec, promptVersion, model };
    }),
});
