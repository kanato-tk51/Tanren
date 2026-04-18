import { z } from "zod";

import { DIFFICULTY_LEVELS, THINKING_STYLES } from "@/db/schema";
import { generateMcq } from "@/server/generator/mcq";

import { protectedProcedure, router } from "../init";

export const questionsRouter = router({
  generate: protectedProcedure
    .input(
      z.object({
        conceptId: z.string().min(1),
        /** MVP は mcq のみ (issue #9)。他タイプは issue #14 以降 */
        type: z.literal("mcq"),
        difficulty: z.enum(DIFFICULTY_LEVELS),
        thinkingStyle: z.enum(THINKING_STYLES).nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      // forceFresh は公開 API に露出させず、サーバー側のフラグ (NODE_ENV=development かつ
      // テストで必要な場合) でのみ許可する。Passkey 認証済みでも OpenAI コスト削減経路を塞ぐ。
      const result = await generateMcq({
        conceptId: input.conceptId,
        difficulty: input.difficulty,
        thinkingStyle: input.thinkingStyle,
      });
      return {
        source: result.source,
        question: {
          id: result.question.id,
          prompt: result.question.prompt,
          distractors: result.question.distractors,
          // answer / explanation は UI 側でユーザー回答後に出す。ここでは返さない
          hint: result.question.hint,
          tags: result.question.tags,
        },
      };
    }),
});
