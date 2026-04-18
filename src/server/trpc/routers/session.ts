import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import {
  attempts,
  concepts,
  DIFFICULTY_LEVELS,
  SESSION_KINDS,
  sessions,
  THINKING_STYLES,
  type DifficultyLevel,
} from "@/db/schema";
import type { CopyForLlmQuestionMeta } from "@/lib/share/copy-for-llm";
import { generateMcq } from "@/server/generator/mcq";
import { gradeAttempt } from "@/server/grader";
import { CustomSessionSpecSchema, type CustomSessionSpec } from "@/server/parser/schema";
import { selectDailyCandidates } from "@/server/scheduler/daily";
import { STREAK_FOR_PROMOTION, computePromotion } from "@/server/scheduler/promotion";

import { protectedProcedure, router } from "../init";

const SessionKindEnum = z.enum(SESSION_KINDS);
const DifficultyEnum = z.enum(DIFFICULTY_LEVELS);
const ThinkingStyleEnum = z.enum(THINKING_STYLES);

const DEFAULT_DRILL_LENGTH = 5;

type SessionSpec = {
  targetCount?: number;
  /** 出題中の question.id。submit 時に一致チェックして「別問題への水増し submit」を防ぐ */
  pendingQuestionId?: string | null;
  /** Custom Session 指定 (kind: 'custom' のときだけ埋まる。issue #18) */
  customSpec?: CustomSessionSpec;
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

async function pickConceptForDrill(userId: string) {
  // Daily Drill の優先度アルゴリズム (docs/06 §6.4) に委譲。
  // due / blind_spot のどちらも空 (= mastered な concept が無く、かつ prereqs が空の concept も無い)
  // だと候補が 0 件になる。MVP の seed (10 concept) では prereqs なし concept が複数あり bootstrap 時も候補が埋まるが、
  // 念のため PRECONDITION_FAILED でクライアントに状況を知らせる。
  const candidates = await selectDailyCandidates({ userId, count: 1 });
  if (candidates[0]) return candidates[0].concept;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "no drill candidate: seed にある concept が 0 件か、全 concept の prereqs が未充足。seed を確認してください",
  });
}

async function loadConcept(conceptId: string) {
  const rows = await getDb().select().from(concepts).where(eq(concepts.id, conceptId)).limit(1);
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `unknown concept: ${conceptId}` });
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
        /** Custom Session 指定時のみ。パース結果 (CustomSessionSpec) を Zod で再検証 */
        customSpec: CustomSessionSpecSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.kind === "custom" && !input.customSpec) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "kind='custom' には customSpec が必要です",
        });
      }
      if (input.kind !== "custom" && input.customSpec) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "customSpec は kind='custom' のときだけ指定できます",
        });
      }

      // MVP 受け入れ基準 (Issue #18): 絶対難易度は beginner/junior/mid/senior のみ。
      // staff/principal は Custom Session では Phase 5+ で解禁するためここで reject する。
      if (input.customSpec?.difficulty) {
        const level = input.customSpec.difficulty.level;
        if (level !== "beginner" && level !== "junior" && level !== "mid" && level !== "senior") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Custom Session MVP は difficulty=${level} に未対応 (beginner/junior/mid/senior のみ)`,
          });
        }
      }
      // MVP は mcq 生成のみ。UI 注記と一致させるため、正確に ['mcq'] (単一要素) だけ許可する。
      // ['mcq', 'written'] などの混在、['mcq', 'mcq'] のような重複も reject。
      if (input.customSpec?.questionTypes && input.customSpec.questionTypes.length > 0) {
        const isExactMcqSingleton =
          input.customSpec.questionTypes.length === 1 &&
          input.customSpec.questionTypes[0] === "mcq";
        if (!isExactMcqSingleton) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Custom Session MVP は questionTypes=['mcq'] のみ許可です",
          });
        }
      }
      // constraints は MVP で生成プロンプトに反映されないため、該当フィールドがあれば reject
      // (プレビューで「指定した」と見えて実行時に無視されるのは虚偽表示に近い挙動なので)。
      if (input.customSpec?.constraints) {
        const c = input.customSpec.constraints;
        if (c.codeLanguage || c.timeLimitSec || c.mustInclude?.length || c.avoid?.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Custom Session MVP は constraints (codeLanguage/timeLimitSec/mustInclude/avoid) 未対応です",
          });
        }
      }
      // domains / subdomains / excludeConcepts も現状プロンプトに反映されないため、
      // 同じ理由 (虚偽表示回避) で reject する。MVP は concepts[0] で concept を直接指定する運用。
      if (
        input.customSpec?.domains?.length ||
        input.customSpec?.subdomains?.length ||
        input.customSpec?.excludeConcepts?.length
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Custom Session MVP は domains / subdomains / excludeConcepts 未対応です (concepts[0] で直接指定してください)",
        });
      }

      const db = getDb();
      // 問題数は customSpec.questionCount があれば優先。なければ input.targetCount、なければ既定 5
      const targetCount =
        input.customSpec?.questionCount ?? input.targetCount ?? DEFAULT_DRILL_LENGTH;
      const spec: SessionSpec = {
        targetCount,
        pendingQuestionId: null,
        ...(input.customSpec ? { customSpec: input.customSpec } : {}),
      };
      const [session] = await db
        .insert(sessions)
        .values({ userId: ctx.user.id, kind: input.kind, spec })
        .returning();
      if (!session) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { sessionId: session.id, targetCount };
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
      // pendingQuestionId がある = 直前の問題を未回答
      if (spec.pendingQuestionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "submit the current pending question before fetching the next one",
        });
      }

      // 原子予約: pendingQuestionId が null のときだけ "__reserved__" にスワップ。
      // 並行 next で losing race になった側は 0 行更新となり早期 return で OpenAI 呼び出しを避ける
      const RESERVED = "__reserving__";
      const reserved = await getDb()
        .update(sessions)
        .set({ spec: { ...spec, pendingQuestionId: RESERVED } })
        .where(
          and(
            eq(sessions.id, session.id),
            sql`(${sessions.spec}->>'pendingQuestionId') IS NULL`,
            isNull(sessions.finishedAt),
          ),
        )
        .returning({ id: sessions.id });
      if (reserved.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "another request already reserved the next question; retry",
        });
      }

      // 予約後に問題生成が失敗したら pendingQuestionId を null に戻してセッションを復帰させる。
      let question: Awaited<ReturnType<typeof generateMcq>>["question"];
      let questionMeta: CopyForLlmQuestionMeta | null = null;
      try {
        // Custom Session は spec.customSpec (absolute difficulty + thinking_style 等) を優先する。
        // MVP での concept 選定: customSpec.concepts[0] → daily pick の 2 段階。
        // domains / subdomains / excludeConcepts は session.start で reject 済みのためここには来ない。
        const customSpec = spec.customSpec;
        const customConceptId = customSpec?.concepts?.[0];
        const conceptRow = input.conceptId
          ? await loadConcept(input.conceptId)
          : customConceptId
            ? await loadConcept(customConceptId)
            : await pickConceptForDrill(ctx.user.id);

        // 直近 STREAK_FOR_PROMOTION 件の同 concept の attempts を見て、3 連続正解なら次出題を 1 段昇格
        const recent = await getDb()
          .select({ correct: attempts.correct })
          .from(attempts)
          .where(and(eq(attempts.userId, ctx.user.id), eq(attempts.conceptId, conceptRow.id)))
          .orderBy(desc(attempts.createdAt))
          .limit(STREAK_FOR_PROMOTION);
        // custom spec があれば絶対難易度を優先 (昇格は無視。ユーザー指定を尊重)
        const requestedDifficulty: DifficultyLevel =
          customSpec?.difficulty?.level ?? input.difficulty;
        const promoted = customSpec
          ? null
          : computePromotion({
              concept: { difficultyLevels: conceptRow.difficultyLevels },
              currentDifficulty: input.difficulty,
              recentCorrect: recent.map((r) => r.correct === true),
            });
        const effectiveDifficulty: DifficultyLevel = promoted ?? requestedDifficulty;

        // thinking_style も custom spec があれば先頭を使う。複数指定はラウンドロビン未実装 (MVP)。
        const effectiveThinkingStyle = customSpec?.thinkingStyles?.[0] ?? input.thinkingStyle;

        const generated = await generateMcq({
          conceptId: conceptRow.id,
          difficulty: effectiveDifficulty,
          thinkingStyle: effectiveThinkingStyle,
        });
        question = generated.question;
        questionMeta = {
          domain: conceptRow.domainId,
          subdomain: conceptRow.subdomainId,
          conceptId: conceptRow.id,
          conceptName: conceptRow.name,
          thinkingStyle: effectiveThinkingStyle,
          difficulty: effectiveDifficulty,
        };
      } catch (err) {
        await getDb()
          .update(sessions)
          .set({ spec: { ...spec, pendingQuestionId: null } })
          .where(eq(sessions.id, session.id))
          .catch(() => {
            // ロールバック失敗は握りつぶす (本体エラーを優先して throw する)
          });
        throw err;
      }

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
          meta: questionMeta,
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

      // 二重送信対策: sql で原子インクリメント + pendingQuestionId 一致 + finishedAt is null の
      // 条件下でのみ 1 行更新。並行 submit で losing race になった側は 0 行更新で素通り
      // (既に 1 度カウントされているので attempts テーブルの一意性で十分)
      const updated = await getDb()
        .update(sessions)
        .set({
          questionCount: sql`${sessions.questionCount} + 1`,
          correctCount: sql`${sessions.correctCount} + ${result.correct ? 1 : 0}`,
          spec: { ...spec, pendingQuestionId: null },
        })
        .where(
          and(
            eq(sessions.id, session.id),
            sql`(${sessions.spec}->>'pendingQuestionId') = ${input.questionId}`,
            isNull(sessions.finishedAt),
          ),
        )
        .returning({ id: sessions.id });
      if (updated.length === 0) {
        // 競合 (同じ問題への並行 submit) は先着が既に処理済み。カウンタは進まずに終了
      }

      return {
        attemptId: result.attempt.id,
        correct: result.correct,
        score: result.score,
        feedback: result.feedback,
        questionType: result.questionType,
        correctAnswer: result.correctAnswer,
        rubricChecks: result.rubricChecks,
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
