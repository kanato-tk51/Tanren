import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { after } from "next/server";

import { getDb } from "@/db/client";
import {
  attempts,
  concepts,
  misconceptions,
  questions,
  sessions,
  type NewAttempt,
  type Question,
  type RubricCheckResult,
} from "@/db/schema";
import { updateMasteryAfterAttempt } from "@/server/scheduler/update-mastery";

import { extractAndPersistMisconception } from "./extract-misconception";
import { gradeMcq } from "./mcq";
import { gradeShort } from "./short";
import { gradeWritten } from "./written";

export type GradeAttemptInput = {
  userId: string;
  sessionId: string;
  questionId: string;
  userAnswer: string;
  /** 回答に要したミリ秒 (UI 側で計測して渡す) */
  elapsedMs?: number;
  /** 「なぜそう答えたか」(任意、誤概念抽出に使う) */
  reasonGiven?: string;
  /**
   * FSRS / mastery 更新を行うか。Custom Session で updateMastery=false が指定された
   * 場合に false を渡すと、attempts への記録はするが mastery テーブルへの波及を抑止する
   * (docs/04 §4.9.2)。未指定なら true (通常 Drill の挙動)。
   */
  updateMastery?: boolean;
};

export type GradeAttemptResult = {
  attempt: { id: string };
  correct: boolean;
  score: number | null;
  feedback: string;
  rubricChecks: RubricCheckResult[];
  /** submit 側で UI 出し分けに使う (MVP では "mcq" / "short" / "written" など) */
  questionType: string;
  /** 採点後に UI で「正解はこれ」と表示するため、および copy-for-llm に使う (issue #16) */
  correctAnswer: string;
};

async function loadQuestion(questionId: string): Promise<Question> {
  const rows = await getDb().select().from(questions).where(eq(questions.id, questionId)).limit(1);
  const q = rows[0];
  if (!q) throw new TRPCError({ code: "NOT_FOUND", message: `unknown question: ${questionId}` });
  return q;
}

/**
 * 同 concept で直近 3 件連続で正解していたら、その concept の unresolved misconception を
 * `resolved=true` に遷移させる (docs/05 §5.8 「矯正できたら resolved=1」の近似)。
 * 厳密には「その misconception が直接矯正されたか」まで見ないが、MVP ではユーザーが
 * 同 concept で連続正答 = 概ね誤解が解けた、という近似で運用する。
 */
async function maybeResolveMisconceptions(params: {
  userId: string;
  conceptId: string;
}): Promise<void> {
  const STREAK_TO_RESOLVE = 3;
  const db = getDb();
  const recent = await db
    .select({ correct: attempts.correct })
    .from(attempts)
    .where(and(eq(attempts.userId, params.userId), eq(attempts.conceptId, params.conceptId)))
    .orderBy(desc(attempts.createdAt))
    .limit(STREAK_TO_RESOLVE);
  if (recent.length < STREAK_TO_RESOLVE) return;
  if (!recent.every((a) => a.correct === true)) return;
  await db
    .update(misconceptions)
    .set({ resolved: true })
    .where(
      and(
        eq(misconceptions.userId, params.userId),
        eq(misconceptions.conceptId, params.conceptId),
        eq(misconceptions.resolved, false),
      ),
    );
}

/** session が呼び出し元ユーザーのものであることを確認。別 user の session への書き込みを防ぐ */
async function assertSessionOwnership(sessionId: string, userId: string): Promise<void> {
  const rows = await getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);
  if (!rows[0]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "session does not belong to the authenticated user",
    });
  }
}

/**
 * 採点 → attempts に永続化する統合関数。
 * 問題タイプによって mcq / short 等にディスパッチする (現在サポート: mcq, short)。
 */
export async function gradeAttempt(input: GradeAttemptInput): Promise<GradeAttemptResult> {
  await assertSessionOwnership(input.sessionId, input.userId);
  const question = await loadQuestion(input.questionId);

  let row: NewAttempt;
  let grade: GradeAttemptResult;

  if (question.type === "mcq") {
    const result = gradeMcq(question, input.userAnswer);
    row = {
      userId: input.userId,
      sessionId: input.sessionId,
      questionId: question.id,
      conceptId: question.conceptId,
      userAnswer: input.userAnswer,
      correct: result.correct,
      score: result.score,
      feedback: result.feedback,
      rubricChecks: [],
      reasonGiven: input.reasonGiven,
      elapsedMs: input.elapsedMs,
      gradedBy: null,
      promptVersion: null,
    };
    grade = {
      attempt: { id: "" },
      correct: result.correct,
      score: result.score,
      feedback: result.feedback,
      rubricChecks: [],
      questionType: question.type,
      correctAnswer: question.answer,
    };
  } else if (question.type === "short" || question.type === "written") {
    const result =
      question.type === "short"
        ? await gradeShort({ question, userAnswer: input.userAnswer })
        : await gradeWritten({ question, userAnswer: input.userAnswer });
    row = {
      userId: input.userId,
      sessionId: input.sessionId,
      questionId: question.id,
      conceptId: question.conceptId,
      userAnswer: input.userAnswer,
      correct: result.correct,
      score: result.score,
      feedback: result.feedback,
      rubricChecks: result.rubricChecks,
      reasonGiven: input.reasonGiven,
      elapsedMs: input.elapsedMs,
      gradedBy: result.model,
      promptVersion: result.promptVersion,
    };
    grade = {
      attempt: { id: "" },
      correct: result.correct,
      score: result.score,
      feedback: result.feedback,
      rubricChecks: result.rubricChecks,
      questionType: question.type,
      correctAnswer: question.answer,
    };
  } else {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: `grading for type="${question.type}" is not implemented yet`,
    });
  }

  // (session_id, question_id) の unique index で二重 submit を防ぐ。
  // 並行送信で losing race になった側は onConflictDoNothing で何も insert しない。
  const inserted = await getDb()
    .insert(attempts)
    .values(row)
    .onConflictDoNothing({ target: [attempts.sessionId, attempts.questionId] })
    .returning();

  if (inserted[0]) {
    grade.attempt.id = inserted[0].id;
    // 採点成功したときだけ mastery を更新 (二重 submit の losing race は更新しない)。
    // Custom Session で updateMastery=false が指定されたときは attempts のみ残して
    // FSRS / mastery は触らない (docs/04 §4.9.2 「お試しモード」)。
    if (input.updateMastery !== false) {
      await updateMasteryAfterAttempt({
        userId: input.userId,
        conceptId: question.conceptId,
        score: grade.score,
      });
    }
    // 誤答 + reason_given が与えられたときだけ誤概念抽出を走らせる (issue #19)。
    // 素の detach promise は Vercel Functions の teardown で切られる可能性があるため、
    // Next.js の after() で post-response に予約する (Round 4 指摘)。
    // 失敗は console.error でログに残す (Sentry 導入 #27 後は captureException に差し替え)。
    if (grade.correct === false && input.reasonGiven && input.reasonGiven.trim().length > 0) {
      const reason = input.reasonGiven;
      const userId = input.userId;
      const conceptId = question.conceptId;
      const qPayload = { prompt: question.prompt, answer: question.answer };
      const userAnswer = input.userAnswer;
      after(async () => {
        try {
          const conceptRow = await getDb()
            .select({ id: concepts.id, name: concepts.name })
            .from(concepts)
            .where(eq(concepts.id, conceptId))
            .limit(1);
          if (!conceptRow[0]) return;
          await extractAndPersistMisconception({
            userId,
            concept: conceptRow[0],
            question: qPayload,
            userAnswer,
            reasonGiven: reason,
          });
        } catch (err) {
           
          console.error("extractAndPersistMisconception failed", err);
        }
      });
    }
    // 正答で unresolved な misconceptions があれば resolve に遷移させる (docs/05 §5.8)。
    // resolve は誤概念履歴側の状態で FSRS とは独立なので updateMastery=false でも走らせる
    // (Round 4 指摘)。1 回の正答では早計なので「直近 3 連続正解」を近似条件にする。
    if (grade.correct === true) {
      const userId = input.userId;
      const conceptId = question.conceptId;
      after(async () => {
        try {
          await maybeResolveMisconceptions({ userId, conceptId });
        } catch (err) {
           
          console.error("maybeResolveMisconceptions failed", err);
        }
      });
    }
    return grade;
  }

  // 既存の attempt を返す (二重送信クライアントにも同じ結果を返す)
  const existing = await getDb()
    .select()
    .from(attempts)
    .where(and(eq(attempts.sessionId, input.sessionId), eq(attempts.questionId, input.questionId)))
    .limit(1);
  const prev = existing[0];
  if (!prev) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  return {
    attempt: { id: prev.id },
    correct: prev.correct ?? false,
    score: prev.score,
    feedback: prev.feedback ?? "",
    rubricChecks: (prev.rubricChecks ?? []) as typeof grade.rubricChecks,
    questionType: question.type,
    correctAnswer: question.answer,
  };
}
