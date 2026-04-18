import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  attempts,
  questions,
  type NewAttempt,
  type Question,
  type RubricCheckResult,
} from "@/db/schema";

import { gradeMcq } from "./mcq";
import { gradeShort } from "./short";

export type GradeAttemptInput = {
  userId: string;
  sessionId: string;
  questionId: string;
  userAnswer: string;
  /** 回答に要したミリ秒 (UI 側で計測して渡す) */
  elapsedMs?: number;
  /** 「なぜそう答えたか」(任意、誤概念抽出に使う) */
  reasonGiven?: string;
};

export type GradeAttemptResult = {
  attempt: { id: string };
  correct: boolean;
  score: number | null;
  feedback: string;
  rubricChecks: RubricCheckResult[];
};

async function loadQuestion(questionId: string): Promise<Question> {
  const rows = await getDb().select().from(questions).where(eq(questions.id, questionId)).limit(1);
  const q = rows[0];
  if (!q) throw new Error(`unknown question: ${questionId}`);
  return q;
}

/**
 * 採点 → attempts に永続化する統合関数。
 * 問題タイプによって mcq / short 等にディスパッチする (現在サポート: mcq, short)。
 */
export async function gradeAttempt(input: GradeAttemptInput): Promise<GradeAttemptResult> {
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
    };
  } else if (question.type === "short") {
    const result = await gradeShort({ question, userAnswer: input.userAnswer });
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
    };
  } else {
    throw new Error(`grading for type="${question.type}" is not implemented (issue #14+)`);
  }

  const [inserted] = await getDb().insert(attempts).values(row).returning();
  if (!inserted) throw new Error("failed to insert attempt");
  grade.attempt.id = inserted.id;
  return grade;
}
