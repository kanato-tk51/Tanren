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
        forceFresh: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await generateMcq({
        conceptId: input.conceptId,
        difficulty: input.difficulty,
        thinkingStyle: input.thinkingStyle,
        forceFresh: input.forceFresh,
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
