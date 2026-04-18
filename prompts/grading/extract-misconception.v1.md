# extract-misconception.v1

誤答時に reason_given (「なぜそう答えたか」) と expected answer から、ユーザーが抱えている
誤概念を抽出する (issue #19, docs/03 §3.4.1, docs/05 §5.8)。

固定の Output requirements を user 冒頭、可変を末尾に置く (CLAUDE.md §4.5)。
gpt-5 を使う。LLM は「誤解の要旨を 1 文で、短く、再発検知しやすい表現」で書く。

---

<!-- role:system -->

You are a senior engineer diagnosing a student's misconception. Given the expected answer and what the student actually answered (plus their reasoning), extract the misconception. Output strictly as JSON matching the provided schema. Use 日本語 for the misconception description.

<!-- /role -->

<!-- role:user -->

## Output requirements (固定)

- `description` (string): 誤解の要旨を 1 文 (最大 100 文字) で日本語で。後で集計キーに使うため、再発を検知しやすい定型表現に (例: 「TLS 1.3 の鍵交換は RSA と誤解」)。
- `confidence` (number 0.0-1.0): この抽出が確度高いかの自己申告。理由 (reason_given) が空 / 曖昧なら低めに。

空な (抽出できない / ユーザーが単に勘違いではなく完全な無知など) 場合は `description: ""` + `confidence: 0` を返すこと。

## Concept (可変)

id: {{ conceptId }}
name: {{ conceptName }}

## Question (可変)

{{ questionPrompt }}

## Expected answer (可変)

{{ expectedAnswer }}

## User's answer (可変)

{{ userAnswer }}

## User's reasoning (可変)

{{ reasonGiven }}

<!-- /role -->
