import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import {
  attempts,
  questions,
  type DialogueRecord,
  type DialogueTurn,
  type RebuttalRecord,
} from "@/db/schema";
import {
  DESIGN_MAX_AI_TURNS,
  DESIGN_PROMPT_VERSION,
  countAiTurns,
  designRubricChecks,
  runDesignTurn,
} from "@/server/grader/design";
import { gradeRebut } from "@/server/grader/rebut";
import {
  reapplyMasteryAfterRebut,
  updateMasteryAfterAttempt,
} from "@/server/scheduler/update-mastery";

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
        rubricChecks: graded.rubricChecks,
      };
    }),

  /**
   * 「詳しく聞く用にコピー」ボタン押下時に呼ぶ (issue #16)。
   *
   * 実際のテキスト生成は `src/lib/share/copy-for-llm.ts` でクライアント側に行い、
   * このエンドポイントはカウンタ (attempts.copied_for_external) を +1 するだけ。
   * 利用率の指標 (docs/09 success metrics) として集計するためのもの。
   */
  /**
   * design 対話採点の follow-up (issue #35)。
   * 既存 attempt (type='design') に対してユーザーの追加メッセージを投げ、LLM の次ターンを得る。
   * AI が 3 ターン発話済みなら 400 (BAD_REQUEST)。LLM が finalized=true を返したら
   * correct / score / feedback / rubricChecks を最終値で上書きし、mastery も更新する。
   */
  followUp: protectedProcedure
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
      if (!prev) throw new TRPCError({ code: "NOT_FOUND", message: "attempt not found" });

      const qRows = await db
        .select()
        .from(questions)
        .where(eq(questions.id, prev.questionId))
        .limit(1);
      const question = qRows[0];
      if (!question) throw new TRPCError({ code: "NOT_FOUND", message: "question not found" });
      if (question.type !== "design") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `type="${question.type}" は対話採点の対象外 (design のみ)`,
        });
      }

      const dialogue: DialogueRecord = prev.dialogue ?? {
        turns: [],
        maxTurns: DESIGN_MAX_AI_TURNS,
        finalized: false,
      };
      if (dialogue.finalized) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "この attempt の対話採点は既に確定しています",
        });
      }
      if (countAiTurns(dialogue.turns) >= DESIGN_MAX_AI_TURNS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `対話は最大 ${DESIGN_MAX_AI_TURNS} ターンまで`,
        });
      }

      const now = new Date();
      // user message を先に append
      const userTurn: DialogueTurn = {
        role: "user",
        message: input.message,
        at: now.toISOString(),
      };
      const turnsWithUser = [...dialogue.turns, userTurn];
      // LLM に次ターンを聞く
      const resp = await runDesignTurn({
        question: { prompt: question.prompt },
        initialUserAnswer: prev.userAnswer ?? "",
        turns: turnsWithUser,
      });
      const aiTurn: DialogueTurn = {
        role: "ai",
        message: resp.nextQuestion ?? resp.feedback ?? "",
        at: new Date().toISOString(),
      };
      const nextDialogue: DialogueRecord = {
        turns: [...turnsWithUser, aiTurn],
        maxTurns: DESIGN_MAX_AI_TURNS,
        finalized: resp.finalized,
      };

      if (resp.finalized) {
        const rubric = designRubricChecks(resp);
        const correct = (resp.score ?? 0) >= 0.8;
        await db
          .update(attempts)
          .set({
            correct,
            score: resp.score,
            feedback: resp.feedback,
            rubricChecks: rubric,
            gradedBy: "gpt-5",
            promptVersion: DESIGN_PROMPT_VERSION,
            dialogue: nextDialogue,
          })
          .where(and(eq(attempts.id, prev.id), eq(attempts.userId, ctx.user.id)));
        // design 採点確定 → mastery へ反映 (既存 drill 系と同じ経路)
        await updateMasteryAfterAttempt({
          userId: ctx.user.id,
          conceptId: prev.conceptId,
          score: resp.score,
        });
        return {
          attemptId: prev.id,
          dialogue: nextDialogue,
          finalized: true,
          correct,
          score: resp.score,
          feedback: resp.feedback,
          rubricChecks: rubric,
        };
      }

      // 中間ターン: dialogue のみ更新
      await db
        .update(attempts)
        .set({ dialogue: nextDialogue })
        .where(and(eq(attempts.id, prev.id), eq(attempts.userId, ctx.user.id)));
      return {
        attemptId: prev.id,
        dialogue: nextDialogue,
        finalized: false,
        correct: prev.correct,
        score: prev.score,
        feedback: prev.feedback,
        rubricChecks: prev.rubricChecks ?? [],
      };
    }),

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
