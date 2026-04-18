/**
 * 採点結果を LLM にコピペして深掘り質問するためのテンプレ整形 (issue #16)。
 *
 * docs/07-ux-and-pwa.md §7.13 に従い、問題文 / 自分の回答 / 採点結果を 1 本のテキストにまとめる。
 * 外部 LLM (ChatGPT / Claude など) に貼り付けて「もっと詳しく教えて」「関連する概念は?」などの
 * 追い質問をするための用途。
 */

export type CopyForLlmInput = {
  question: {
    prompt: string;
    /** 期待回答。mcq の場合は正解の選択肢 */
    answer: string;
    /** 任意: タグや分野 (表示するなら) */
    tags?: string[] | null;
    /** 任意: ヒント */
    hint?: string | null;
  };
  userAnswer: string;
  grading: {
    correct: boolean | null;
    score: number | null;
    feedback: string | null;
  };
};

function formatCorrect(correct: boolean | null): string {
  if (correct === true) return "○ 正解";
  if (correct === false) return "× 不正解";
  return "未判定";
}

function formatScore(score: number | null): string {
  if (score === null) return "未評価";
  return score.toFixed(2);
}

/**
 * プロンプト全体を組み立てる。貼り付け先でコードブロックや引用が混ざらないよう、
 * シンプルな見出し + プレーンテキストでまとめる。
 */
export function buildCopyForLlm(input: CopyForLlmInput): string {
  const { question, userAnswer, grading } = input;
  const lines: string[] = [];

  lines.push(
    "以下の問題と、自分の回答・採点結果を共有します。理解を深めるために詳しく解説してください。",
  );
  lines.push("");
  if (question.tags && question.tags.length > 0) {
    lines.push(`# 分野`);
    lines.push(question.tags.join(" / "));
    lines.push("");
  }
  lines.push(`# 問題`);
  lines.push(question.prompt);
  lines.push("");
  if (question.hint) {
    lines.push(`# ヒント`);
    lines.push(question.hint);
    lines.push("");
  }
  lines.push(`# 期待される回答`);
  lines.push(question.answer);
  lines.push("");
  lines.push(`# 自分の回答`);
  lines.push(userAnswer.length > 0 ? userAnswer : "(未回答)");
  lines.push("");
  lines.push(`# 採点`);
  lines.push(`- 判定: ${formatCorrect(grading.correct)}`);
  lines.push(`- スコア: ${formatScore(grading.score)}`);
  if (grading.feedback) {
    lines.push(`- フィードバック: ${grading.feedback}`);
  }
  lines.push("");
  lines.push(`# お願い`);
  lines.push("1. 期待回答と自分の回答の差分がどこにあるか指摘してください。");
  lines.push("2. この概念で混同しがちなポイントや関連概念を教えてください。");
  lines.push("3. 次に押さえるべき学習項目を 1-2 個挙げてください。");

  return lines.join("\n");
}
