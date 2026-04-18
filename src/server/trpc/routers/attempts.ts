import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { attempts, questions, type RebuttalRecord } from "@/db/schema";
import { gradeRebut } from "@/server/grader/rebut";
import { reapplyMasteryAfterRebut } from "@/server/scheduler/update-mastery";

import { protectedProcedure, router } from "../init";

/** mcq は構造化された正誤なので LLM による再採点対象外 */
const REBUTTABLE_TYPES = ["short", "written"] as const;

export const attemptsRouter = router({
  /**
   * 採点への反論 (issue #15, R1 対策)。
   * 元の判定を rebuttal フィールドに保存し、再採点結果で correct / score / feedback を上書きする。
   *
   * 並行 2 重 rebut 対策として最終 UPDATE の WHERE に `rebuttal IS NULL` を加えている。
   * losing race 側は 0 行更新になり BAD_REQUEST を返す。
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

      // race 対策: WHERE に `rebuttal IS NULL` を加えて losing race 側は 0 行更新にする
      const updated = await db
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
        .where(
          and(
            eq(attempts.id, prev.id),
            eq(attempts.userId, ctx.user.id),
            isNull(attempts.rebuttal),
          ),
        )
        .returning({ id: attempts.id });
      if (updated.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "この attempt には既に反論が提出されています",
        });
      }

      // 採点結果が変わった場合は mastery も追随させる (lapseCount delta + FSRS 再適用)
      await reapplyMasteryAfterRebut({
        userId: ctx.user.id,
        conceptId: prev.conceptId,
        previousScore: prev.score,
        newScore: graded.score,
      });

      return {
        attemptId: prev.id,
        correct: graded.correct,
        score: graded.score,
        feedback: graded.feedback,
        overturned,
      };
    }),

  /**
   * 「詳しく聞く用にコピー」ボタン押下時に呼ぶ (issue #16)。
   *
   * 実際のテキスト生成は `src/lib/share/copy-for-llm.ts` でクライアント側に行い、
   * このエンドポイントはカウンタ (attempts.copied_for_external) を +1 するだけ。
   * 利用率の指標 (docs/09 success metrics) として集計するためのもの。
   */
  markCopiedForExternal: protectedProcedure
    .input(z.object({ attemptId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .update(attempts)
        .set({ copiedForExternal: sql`${attempts.copiedForExternal} + 1` })
        .where(and(eq(attempts.id, input.attemptId), eq(attempts.userId, ctx.user.id)))
        .returning({ id: attempts.id, copiedForExternal: attempts.copiedForExternal });
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "attempt not found" });
      return { attemptId: row.id, copiedForExternal: row.copiedForExternal };
    }),
});
