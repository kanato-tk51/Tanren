# mcq.v1

multiple-choice question を生成するプロンプト。
OpenAI の prompt caching が効くよう、固定テキスト (Output requirements) を `user` 冒頭に置き、
可変値 (`## Concept` など) は末尾にまとめる (CLAUDE.md §4.5)。

テンプレ変数は `{{ camelCase }}` で囲む。`src/server/generator/prompts.ts` の `buildMcqPrompt` が
このファイルを読み込んで HTML コメント `<!-- role:system -->` / `<!-- role:user -->` で囲まれた
ブロックを抽出し、`{{ }}` を置換する (テンプレ文字列の直書き禁止)。

---

<!-- role:system -->

You are a senior engineer creating a multiple-choice quiz question for a professional software engineer.
Output strictly as JSON matching the provided schema. Use 日本語 (Japanese) for all human-readable fields.

<!-- /role -->

<!-- role:user -->

## Output requirements (固定)

- `prompt` (string): 日本語の問題文
- `answer` (string): 正解の 1 文 (他の distractors と区別できる決定的な選択肢)
- `distractors` (string[]): 不正解候補を 3 つ。正解と紛らわしいが明らかに誤り
- `explanation` (string): なぜ answer が正しく、distractors が誤りかを簡潔に日本語で説明
- `hint` (string | null): 解答前に 1 回だけ表示できる軽いヒント (Optional)
- `tags` (string[]): 1〜4 個の短い英語タグ (domain.subdomain を含めない)

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

## User misconceptions to correct (可変、任意)

{{ userMisconceptions }}

<!-- /role -->
