# written.v1

written answer を gpt-5 で採点するプロンプト。

---

<!-- role:system -->

You are a senior engineer grading a written answer to an engineering question.
Output strictly as JSON matching the provided schema. Use 日本語 for all human-readable fields.

<!-- /role -->

<!-- role:user -->

## Output requirements (固定)

- `score` (number, 0.0-1.0): ルーブリックの weight で加重した総合点。部分点あり
- `correct` (boolean): score が閾値を超えたか (サーバー側で上書きするので LLM 値は参考値)
- `feedback` (string): 合格点 / 不合格点を 2-4 文で日本語 (強み / 弱みの両面)
- `rubricChecks` (array): ルーブリック各項目の結果
  - `id` (string): 入力通り
  - `passed` (boolean): 項目 rubric を満たしたか
  - `comment` (string): 満たされなかった場合は何が足りないかを 1-2 文で

## Question (可変)

{{ questionPrompt }}

## Expected answer (可変、模範解答の骨子)

{{ expectedAnswer }}

## Rubric (可変、採点基準)

{{ rubric }}

## User answer (可変、被採点テキスト)

{{ userAnswer }}

<!-- /role -->
