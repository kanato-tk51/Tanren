import { z } from "zod";

import { DIFFICULTY_LEVELS, THINKING_STYLES } from "@/db/schema";
import { generateMcq } from "@/server/generator/mcq";
import { generateShortWritten } from "@/server/generator/short-written";

import { protectedProcedure, router } from "../init";

export const questionsRouter = router({
  generate: protectedProcedure
    .input(
      z.object({
        conceptId: z.string().min(1),
        type: z.enum(["mcq", "short", "written"]),
        difficulty: z.enum(DIFFICULTY_LEVELS),
        thinkingStyle: z.enum(THINKING_STYLES).nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.type === "mcq") {
        const result = await generateMcq({
          conceptId: input.conceptId,
          difficulty: input.difficulty,
          thinkingStyle: input.thinkingStyle,
        });
        return {
          source: result.source,
          question: {
            id: result.question.id,
            type: "mcq" as const,
            prompt: result.question.prompt,
            distractors: result.question.distractors,
            hint: result.question.hint,
            tags: result.question.tags,
          },
        };
      }
      const result = await generateShortWritten({
        conceptId: input.conceptId,
        type: input.type,
        difficulty: input.difficulty,
        thinkingStyle: input.thinkingStyle,
      });
      return {
        source: result.source,
        question: {
          id: result.question.id,
          type: input.type,
          prompt: result.question.prompt,
          hint: result.question.hint,
          tags: result.question.tags,
          // short / written は textarea 回答。rubric は採点前に UI に出さない (バイアス防止)
        },
      };
    }),
});
