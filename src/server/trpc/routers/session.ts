import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import {
  attempts,
  concepts,
  DIFFICULTY_LEVELS,
  SESSION_KINDS,
  sessions,
  THINKING_STYLES,
} from "@/db/schema";
import { generateMcq } from "@/server/generator/mcq";
import { gradeAttempt } from "@/server/grader";

import { protectedProcedure, router } from "../init";

const SessionKindEnum = z.enum(SESSION_KINDS);
const DifficultyEnum = z.enum(DIFFICULTY_LEVELS);
const ThinkingStyleEnum = z.enum(THINKING_STYLES);

const DEFAULT_DRILL_LENGTH = 5;

async function loadSession(sessionId: string, userId: string) {
  const rows = await getDb()
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "session not found" });
  if (row.finishedAt) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "session already finished" });
  }
  return row;
}

/** Daily Drill の concept 候補を選ぶ (MVP: concepts テーブルから適当に一件)。Phase 2 で FSRS 連携 */
async function pickConceptForDrill() {
  const rows = await getDb().select().from(concepts).limit(1);
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "no seeded concept" });
  return row;
}

export const sessionRouter = router({
  start: protectedProcedure
    .input(
      z.object({
        kind: SessionKindEnum.default("daily"),
        targetCount: z.number().int().min(1).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [session] = await db
        .insert(sessions)
        .values({
          userId: ctx.user.id,
          kind: input.kind,
          // MVP は targetCount を spec に記録 (カラム化は Phase 2 で検討)
          spec: { targetCount: input.targetCount ?? DEFAULT_DRILL_LENGTH },
        })
        .returning();
      if (!session) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { sessionId: session.id };
    }),

  next: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        /** concept 指定が無ければ自動選択 */
        conceptId: z.string().optional(),
        difficulty: DifficultyEnum.default("junior"),
        thinkingStyle: ThinkingStyleEnum.nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await loadSession(input.sessionId, ctx.user.id);
      const target =
        (session.spec as { targetCount?: number } | null)?.targetCount ?? DEFAULT_DRILL_LENGTH;
      if (session.questionCount >= target) {
        return { done: true as const };
      }

      const concept = input.conceptId ? { id: input.conceptId } : await pickConceptForDrill();

      const { question } = await generateMcq({
        conceptId: concept.id,
        difficulty: input.difficulty,
        thinkingStyle: input.thinkingStyle,
      });

      return {
        done: false as const,
        question: {
          id: question.id,
          prompt: question.prompt,
          distractors: (question.distractors ?? []) as string[],
          hint: question.hint,
          tags: (question.tags ?? []) as string[],
          answer: question.answer,
        },
      };
    }),

  submit: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        questionId: z.string().min(1),
        userAnswer: z.string(),
        elapsedMs: z.number().int().min(0).optional(),
        reasonGiven: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await loadSession(input.sessionId, ctx.user.id);
      const result = await gradeAttempt({
        userId: ctx.user.id,
        sessionId: session.id,
        questionId: input.questionId,
        userAnswer: input.userAnswer,
        elapsedMs: input.elapsedMs,
        reasonGiven: input.reasonGiven,
      });
      // セッションカウンタ更新
      await getDb()
        .update(sessions)
        .set({
          questionCount: session.questionCount + 1,
          correctCount: session.correctCount + (result.correct ? 1 : 0),
        })
        .where(eq(sessions.id, session.id));
      return {
        attemptId: result.attempt.id,
        correct: result.correct,
        score: result.score,
        feedback: result.feedback,
      };
    }),

  finish: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const session = await loadSession(input.sessionId, ctx.user.id);
      const [updated] = await getDb()
        .update(sessions)
        .set({ finishedAt: new Date() })
        .where(eq(sessions.id, session.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // attempts から正答数を集計 (念のため最終再計算)
      const allAttempts = await getDb()
        .select({ correct: attempts.correct })
        .from(attempts)
        .where(eq(attempts.sessionId, session.id));
      const correct = allAttempts.filter((a) => a.correct === true).length;
      return {
        sessionId: updated.id,
        questionCount: allAttempts.length,
        correctCount: correct,
        accuracy: allAttempts.length > 0 ? correct / allAttempts.length : 0,
      };
    }),
});
