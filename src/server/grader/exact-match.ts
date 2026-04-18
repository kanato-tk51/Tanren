import type { Question } from "@/db/schema";

export type ExactMatchGradeResult = {
  correct: boolean;
  score: 0 | 1;
  feedback: string;
};

/**
 * cloze (穴埋め) / code_read (コード読解: 出力予測) 用の完全一致採点 (issue #31)。
 *
 * 判定ロジック:
 *   1. trim
 *   2. 全角 → 半角 (NFKC 正規化) で数字記号の表記ゆれを吸収
 *   3. 末尾改行 / 連続空白を 1 個に圧縮 (タブ / スペース / 全角スペース)
 *   4. 大文字小文字を ignore しない (code_read で case sensitive が重要なため)
 *   5. question.answer に同じ正規化を通して比較
 *
 * LLM は使わない (docs/03 §3.4.1 の mcq 採点と同じ「プロンプトを節約するための rule-based」)。
 * code_read の実行結果照合は Phase 6 の Judge0 (issue #34) で置き換える想定だが、
 * MVP ではユーザーが予測した出力文字列と question.answer (期待出力) の文字列比較で十分。
 */
export function gradeExactMatch(
  question: Pick<Question, "answer" | "type">,
  userAnswer: string,
): ExactMatchGradeResult {
  const normalize = (s: string): string =>
    s
      .normalize("NFKC")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t\u3000]+/g, " ")
      .replace(/[ \t\u3000]*\n[ \t\u3000]*/g, "\n")
      .trim();

  const expected = normalize(question.answer);
  const actual = normalize(userAnswer);
  const correct = expected === actual;
  return {
    correct,
    score: correct ? 1 : 0,
    feedback: correct ? "正解です" : `正解は: ${question.answer}`,
  };
}
