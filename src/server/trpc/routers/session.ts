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

type SessionSpec = {
  targetCount?: number;
  /** 出題中の question.id。submit 時に一致チェックして「別問題への水増し submit」を防ぐ */
  pendingQuestionId?: string | null;
};

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

async function pickConceptForDrill() {
  const rows = await getDb().select().from(concepts).limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "no seeded concept" });
  }
  return row;
}

/** サーバー側でシャッフルした options (answer + distractors) を返す。seed は question.id */
function shuffleWithSeed<T>(array: T[], seed: string): T[] {
  const copy = array.slice();
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = copy.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [copy[i]!, copy[j]!] = [copy[j]!, copy[i]!];
  }
  return copy;
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
      const spec: SessionSpec = {
        targetCount: input.targetCount ?? DEFAULT_DRILL_LENGTH,
        pendingQuestionId: null,
      };
      const [session] = await db
        .insert(sessions)
        .values({ userId: ctx.user.id, kind: input.kind, spec })
        .returning();
      if (!session) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { sessionId: session.id, targetCount: spec.targetCount };
    }),

  next: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        conceptId: z.string().optional(),
        difficulty: DifficultyEnum.default("junior"),
        thinkingStyle: ThinkingStyleEnum.nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await loadSession(input.sessionId, ctx.user.id);
      const spec = (session.spec ?? {}) as SessionSpec;
      const target = spec.targetCount ?? DEFAULT_DRILL_LENGTH;
      if (session.questionCount >= target) {
        return { done: true as const };
      }

      const concept = input.conceptId ? { id: input.conceptId } : await pickConceptForDrill();
      const { question } = await generateMcq({
        conceptId: concept.id,
        difficulty: input.difficulty,
        thinkingStyle: input.thinkingStyle,
      });

      // 出題中の questionId を session に記録 (submit 時の整合性チェック用)
      await getDb()
        .update(sessions)
        .set({ spec: { ...spec, pendingQuestionId: question.id } })
        .where(eq(sessions.id, session.id));

      // answer はクライアントに返さず options だけ返す (正答漏洩防止)
      const options = shuffleWithSeed(
        [question.answer, ...((question.distractors ?? []) as string[])],
        question.id,
      );
      return {
        done: false as const,
        question: {
          id: question.id,
          prompt: question.prompt,
          options,
          hint: question.hint,
          tags: (question.tags ?? []) as string[],
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
      const spec = (session.spec ?? {}) as SessionSpec;
      if (spec.pendingQuestionId !== input.questionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "questionId does not match the pending question for this session",
        });
      }

      const result = await gradeAttempt({
        userId: ctx.user.id,
        sessionId: session.id,
        questionId: input.questionId,
        userAnswer: input.userAnswer,
        elapsedMs: input.elapsedMs,
        reasonGiven: input.reasonGiven,
      });

      await getDb()
        .update(sessions)
        .set({
          questionCount: session.questionCount + 1,
          correctCount: session.correctCount + (result.correct ? 1 : 0),
          spec: { ...spec, pendingQuestionId: null },
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
      const spec = (session.spec ?? {}) as SessionSpec;
      const target = spec.targetCount ?? DEFAULT_DRILL_LENGTH;
      // targetCount に達していない状態での finish は拒否 (受け入れ基準の保証)
      if (session.questionCount < target) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `session cannot finish before ${target} questions (current: ${session.questionCount})`,
        });
      }

      const [updated] = await getDb()
        .update(sessions)
        .set({ finishedAt: new Date() })
        .where(eq(sessions.id, session.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
