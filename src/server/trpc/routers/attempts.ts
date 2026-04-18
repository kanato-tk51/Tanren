import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { attempts, questions, type RebuttalRecord } from "@/db/schema";
import { gradeRebut } from "@/server/grader/rebut";

import { protectedProcedure, router } from "../init";

/** mcq は構造化された正誤なので LLM による再採点対象外 */
const REBUTTABLE_TYPES = ["short", "written"] as const;

export const attemptsRouter = router({
  /**
   * 採点への反論 (issue #15, R1 対策)。
   * 元の判定を rebuttal フィールドに保存し、再採点結果で correct / score / feedback を上書きする。
   */
  rebut: protectedProcedure
    .input(
      z.object({
        attemptId: z.string().min(1),
        message: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(attempts)
        .where(and(eq(attempts.id, input.attemptId), eq(attempts.userId, ctx.user.id)))
        .limit(1);
      const prev = rows[0];
      if (!prev) {
        throw new TRPCError({ code: "NOT_FOUND", message: "attempt not found" });
      }
      if (prev.rebuttal) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "この attempt には既に反論が提出されています",
        });
      }

      const qRows = await db
        .select()
        .from(questions)
        .where(eq(questions.id, prev.questionId))
        .limit(1);
      const question = qRows[0];
      if (!question) throw new TRPCError({ code: "NOT_FOUND", message: "question not found" });
      if (!(REBUTTABLE_TYPES as readonly string[]).includes(question.type)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `type="${question.type}" は反論の対象外 (短答・記述のみ)`,
        });
      }

      const graded = await gradeRebut({
        question,
        userAnswer: prev.userAnswer ?? "",
        rebuttalMessage: input.message,
        original: { correct: prev.correct, score: prev.score, feedback: prev.feedback },
      });

      const overturned = graded.correct !== prev.correct || (graded.score ?? 0) > (prev.score ?? 0);
      const rebuttal: RebuttalRecord = {
        message: input.message,
        original: {
          correct: prev.correct,
          score: prev.score,
          feedback: prev.feedback,
        },
        overturned,
        promptVersion: graded.promptVersion,
        at: new Date().toISOString(),
      };

      await db
        .update(attempts)
        .set({
          correct: graded.correct,
          score: graded.score,
          feedback: graded.feedback,
          rubricChecks: graded.rubricChecks,
          gradedBy: graded.model,
          promptVersion: graded.promptVersion,
          rebuttal,
        })
        .where(eq(attempts.id, prev.id));

      return {
        attemptId: prev.id,
        correct: graded.correct,
        score: graded.score,
        feedback: graded.feedback,
        overturned,
      };
    }),
});
