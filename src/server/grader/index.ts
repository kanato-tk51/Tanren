import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  attempts,
  questions,
  sessions,
  type NewAttempt,
  type Question,
  type RubricCheckResult,
} from "@/db/schema";
import { updateMasteryAfterAttempt } from "@/server/scheduler/update-mastery";

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
