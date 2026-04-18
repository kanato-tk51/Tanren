# short.v1

short answer (1-2 文の短答) の問題を gpt-5 で生成するプロンプト。
Output requirements を user 冒頭、可変は末尾 (CLAUDE.md §4.5 prompt caching)。

---

<!-- role:system -->

You are a senior engineer creating a short-answer quiz question for a professional software engineer.
Output strictly as JSON matching the provided schema. Use 日本語 (Japanese) for all human-readable fields.

<!-- /role -->

<!-- role:user -->

## Output requirements (固定)

- `prompt` (string): 日本語の問題文 (1-2 文の答えで十分なレベル)
- `answer` (string): 期待される模範解答 (1-2 文)
- `rubric` (array of object): 採点基準 2-4 項目
  - `id` (string): 項目識別子 (例: "r1")
  - `description` (string): この項目が満たされる条件
  - `weight` (number): 0-1 の重み (合計 1 に近くなるように)
- `hint` (string | null): 解答前に 1 回だけ表示できるヒント (Optional)
- `explanation` (string): 模範解答の補足説明 (1-3 文)
- `tags` (string[]): 1〜4 個の短い英語タグ

## Concept (可変)

id: {{ conceptId }}
name: {{ conceptName }}
description: {{ conceptDescription }}
domain: {{ domainId }}
subdomain: {{ subdomainId }}

## Spec (可変)

difficulty: {{ difficulty }}
thinking_style: {{ thinkingStyle }}

## Style instruction (可変)

{{ styleInstruction }}

## Avoid duplicates (可変)

Past recent framings for this concept (last 30 days, if any):
{{ pastQuestionsSummary }}

<!-- /role -->
