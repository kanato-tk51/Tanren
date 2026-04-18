import type { Question } from "@/db/schema";

export type McqGradeResult = {
  correct: boolean;
  score: 0 | 1;
  feedback: string;
};

/**
 * mcq の採点は LLM を使わず完全一致判定のみ (docs/03 §3.4.1)。
 * 受け入れるのは answer テキストそのもの、または distractors に含まれるテキスト。
 * 正解以外はすべて不正解。
 */
export function gradeMcq(
  question: Pick<Question, "answer" | "distractors">,
  userAnswer: string,
): McqGradeResult {
  const trimmed = userAnswer.trim();
  const isCorrect = trimmed === question.answer.trim();
  return {
    correct: isCorrect,
    score: isCorrect ? 1 : 0,
    feedback: isCorrect ? "正解です" : `正解は: ${question.answer}`,
  };
}
