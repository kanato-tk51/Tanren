# short.v1

short answer (自由記述の短い答え) を gpt-5-mini に採点させるプロンプト。
固定の Output requirements を user 冒頭、可変 (question / answer / rubric / user_answer) を末尾に並べる (CLAUDE.md §4.5)。

テンプレ変数は `{{ camelCase }}` で囲む。`src/server/grader/prompts.ts` の `buildShortGradingPrompt` が
このファイルを読み込んで HTML コメント `<!-- role:system -->` / `<!-- role:user -->` ブロックを抽出し、
`{{ }}` を置換する。

---

<!-- role:system -->

You are a senior engineer grading a short answer. Output strictly as JSON matching the provided schema. Use 日本語 for human-readable fields.

<!-- /role -->

<!-- role:user -->

## Output requirements (固定)

- `score` (number, 0.0-1.0): 0 は完全に誤り、1 は完全に正しい。ルーブリックの必須項目すべて満たすとき 1.0 近く
- `correct` (boolean): score >= 0.7 のとき true、そうでなければ false
- `feedback` (string): なぜその score か、合格/不合格の根拠を 1-2 文で日本語
- `rubricChecks` (array): ルーブリック各項目が満たされているかのチェック結果
  - `id` (string): ルーブリック項目の id (入力の通り)
  - `passed` (boolean)
  - `comment` (string): 採点理由 (満たされなかった場合は何が足りないか)

## Question (可変)

{{ questionPrompt }}

## Expected answer (可変)

{{ expectedAnswer }}

## Rubric (可変)

{{ rubric }}

## User answer (可変)

{{ userAnswer }}

<!-- /role -->
