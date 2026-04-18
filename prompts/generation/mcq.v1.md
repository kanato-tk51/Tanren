# mcq.v1

multiple-choice question を生成するプロンプト。
共通 prefix は先頭に置き、prompt caching (OpenAI 自動) が効くようにする (CLAUDE.md §4.5)。

---

## system

You are a senior engineer creating a multiple-choice quiz question for a professional software engineer.
Output strictly as JSON matching the provided schema. Use 日本語 (Japanese) for all human-readable fields.

## user (テンプレ変数は `{}` で囲む)

## Concept

id: {concept.id}
name: {concept.name}
description: {concept.description}
domain: {concept.domainId}
subdomain: {concept.subdomainId}

## Spec

difficulty: {difficulty}
thinking_style: {thinking_style}

## Style instruction

{styleInstruction}

## Avoid duplicates

Past recent framings for this concept (last 30 days, if any):
{pastQuestionsSummary}

## Output requirements

- `prompt` (string): 日本語の問題文
- `answer` (string): 正解の 1 文 (他の distractors と区別できる決定的な選択肢)
- `distractors` (string[]): 不正解候補を 3 つ。正解と紛らわしいが明らかに誤り
- `explanation` (string): なぜ answer が正しく、distractors が誤りかを簡潔に日本語で説明
- `hint` (string | null): 解答前に 1 回だけ表示できる軽いヒント (Optional)
- `tags` (string[]): 1〜4 個の短い英語タグ (domain.subdomain を含めない)
