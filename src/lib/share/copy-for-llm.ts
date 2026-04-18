/**
 * 採点結果を外部 LLM (ChatGPT / Claude) にコピペして深掘り質問するためのテンプレ整形 (issue #16)。
 * テンプレ定義は docs/07-ux-and-pwa.md §7.13.4 に従う。
 */

const MAX_USER_ANSWER_LEN = 2000;

/**
 * copy-for-llm テンプレ (docs §7.13.4) に使う concept / 出題メタ。
 * UI と server の間で共有される型定義の真実の源 (重複定義禁止)。
 */
export type CopyForLlmQuestionMeta = {
  domain?: string | null;
  subdomain?: string | null;
  conceptName?: string | null;
  conceptId?: string | null;
  thinkingStyle?: string | null;
  difficulty?: string | null;
};

export type CopyForLlmInput = {
  question: {
    prompt: string;
    /** 期待回答。mcq の場合は正解の選択肢 */
    answer: string;
    /** 任意: タグや分野 (表示するなら) */
    tags?: string[] | null;
    /** 任意: ヒント */
    hint?: string | null;
    /** docs §7.13.4 に従う任意メタ。取得可能なものだけ埋める */
    meta?: CopyForLlmQuestionMeta | null;
  };
  userAnswer: string;
  grading: {
    correct: boolean | null;
    score: number | null;
    feedback: string | null;
    rubricChecks?: Array<{ id: string; passed: boolean; comment: string }> | null;
  };
};

/**
 * 貼り付け先で誤解を招かないよう、本文中のコードブロック開始文字列 ``` を
 * 似た形の `~~~` に置換する。これで 3 連バッククォートの衝突が避けられる。
 */
function sanitize(text: string): string {
  return text.replace(/```/g, "~~~");
}

/** タグやメタラベルに使う 1 行化 + sanitize。改行が入るとテンプレの箇条書き構造が壊れる */
function sanitizeLine(text: string): string {
  return sanitize(text)
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function truncate(text: string): string {
  if (text.length <= MAX_USER_ANSWER_LEN) return text;
  return `${text.slice(0, MAX_USER_ANSWER_LEN)}...`;
}

function formatDomainLine(meta: NonNullable<CopyForLlmInput["question"]["meta"]>): string | null {
  const left = meta.domain ? sanitizeLine(meta.domain) : "";
  const right = meta.subdomain ? sanitizeLine(meta.subdomain) : "";
  if (!left && !right) return null;
  return `- ドメイン: ${left || "-"} > ${right || "-"}`;
}

function formatConceptLine(meta: NonNullable<CopyForLlmInput["question"]["meta"]>): string | null {
  const name = meta.conceptName ? sanitizeLine(meta.conceptName) : "";
  const id = meta.conceptId ? sanitizeLine(meta.conceptId) : "";
  if (!name && !id) return null;
  if (name && id) return `- 概念: ${name} (${id})`;
  return `- 概念: ${name || id}`;
}

function formatRubricChecks(
  rubricChecks: NonNullable<CopyForLlmInput["grading"]["rubricChecks"]>,
): string {
  if (rubricChecks.length === 0) return "  - (採点ルーブリックなし)";
  return rubricChecks
    .map(
      (r) =>
        `  - id=${sanitizeLine(r.id)}: ${r.passed ? "✓" : "✗"} ${sanitizeLine(r.comment ?? "")}`,
    )
    .join("\n");
}

/**
 * docs/07 §7.13.4 のテンプレートに沿って貼り付け用テキストを組み立てる。
 * 取得できないメタ (concept 名など) はセクション/行ごとスキップする。
 */
export function buildCopyForLlm(input: CopyForLlmInput): string {
  const { question, userAnswer, grading } = input;
  const meta = question.meta ?? {};
  const lines: string[] = [];

  lines.push("私はエンジニア学習アプリで以下の問題に答えました。");
  lines.push("詳しく解説してほしいです。特に以下をお願いします。");
  lines.push("");
  lines.push("1. 私の回答のどの部分が合っていて、どの部分が不足/誤解しているか");
  lines.push("2. この概念の背景 (なぜこういう仕組みになっているか)");
  lines.push("3. 関連する概念や、実務でのハマりどころ");
  lines.push("4. 理解が深まる具体例を 1-2 個");
  lines.push("");
  lines.push("---");
  lines.push("");

  const metaLines: string[] = [];
  const domainLine = formatDomainLine(meta);
  if (domainLine) metaLines.push(domainLine);
  const conceptLine = formatConceptLine(meta);
  if (conceptLine) metaLines.push(conceptLine);
  if (meta.thinkingStyle) metaLines.push(`- 思考スタイル: ${sanitizeLine(meta.thinkingStyle)}`);
  if (meta.difficulty) metaLines.push(`- 難易度: ${sanitizeLine(meta.difficulty)}`);
  if (question.tags && question.tags.length > 0) {
    metaLines.push(`- タグ: ${question.tags.map(sanitizeLine).join(" / ")}`);
  }

  lines.push("## 問題");
  if (metaLines.length > 0) {
    lines.push(...metaLines);
    lines.push("");
  }
  lines.push(sanitize(question.prompt));
  lines.push("");

  if (question.hint) {
    lines.push("## ヒント");
    lines.push(sanitize(question.hint));
    lines.push("");
  }

  lines.push("## 模範解答");
  lines.push(sanitize(question.answer));
  lines.push("");

  lines.push("## 私の回答");
  lines.push(userAnswer.length > 0 ? sanitize(truncate(userAnswer)) : "(未回答)");
  lines.push("");

  lines.push("## Tanren の採点");
  if (grading.score !== null) {
    lines.push(`- スコア: ${grading.score.toFixed(2)} / 1.0`);
  } else {
    lines.push("- スコア: 未評価");
  }
  if (grading.correct !== null) {
    lines.push(`- 判定: ${grading.correct ? "○ 正解" : "× 不正解"}`);
  }
  if (grading.rubricChecks && grading.rubricChecks.length > 0) {
    lines.push("- ルーブリック:");
    lines.push(formatRubricChecks(grading.rubricChecks));
  }
  if (grading.feedback) {
    lines.push(`- フィードバック: ${sanitize(grading.feedback)}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("上記を踏まえて、初学者にも分かるように丁寧に解説してください。");

  return lines.join("\n");
}
