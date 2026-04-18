# 03. AI 活用戦略

Tanren は **OpenAI API (GPT-5 系列)** を中核とする (ADR-0005)。問題生成、採点、NL パース、誤概念抽出など、すべての AI 処理を API 経由で行う。Agent 型ツールはバックエンドには使わない。

---

## 3.0. MVP での使用モデル

| 用途                          | モデル                 | 備考                             |
| ----------------------------- | ---------------------- | -------------------------------- |
| 問題生成 (全タイプ)           | `gpt-5`                | Structured Outputs を利用        |
| 採点 (mcq/cloze 以外)         | `gpt-5`                | 精度重視                         |
| 採点 (short)                  | `gpt-5-mini`           | 安い、ルーブリック判定十分       |
| NL → CustomSessionSpec パース | `gpt-5-mini`           | 低レイテンシ、Structured Outputs |
| 誤概念抽出                    | `gpt-5`                | 微妙な誤解を捉える精度           |
| 反論時の再採点                | `gpt-5` (別プロンプト) | MVP 必須 (R1)                    |
| Weekly digest 生成 (Phase 3+) | `gpt-5`                | 自然な文章                       |

> モデル名は OpenAI の命名更新に追随。実体は `src/lib/openai/models.ts` の定数 1 箇所で管理。

**Phase 2+** で `gpt-5` + `reasoning_effort: high` を senior 以上の問題や `code_debug` 系に限定投入。

---

## 3.1. 基本方針

### なぜ Web API 一択か

1. **単一 API 呼び出し = 単一問題** で設計がシンプル、デバッグ容易、再現性が高い
2. **レイテンシが低い** (数秒〜10秒程度)
3. **Structured Outputs (`response_format: { type: 'json_schema' }`)** で JSON を型安全に得られる
4. **Prompt Caching が自動**で効く (1024 tokens 以上の共通 prefix)

### Agent 型ツール (Claude Code / Codex / OpenAI Agents SDK) を使わない理由

- 問題生成・採点はシングルターンで十分、エージェントループは過剰
- 並列呼び出し・レイテンシ・コストの予測性が Chat Completions / Responses API 直叩きの方が良い
- 将来 Agent が必要になる局面 (ユーザーコードからの問題生成など) は `3.7` で別途実装

---

## 3.2. モデル選定

| 用途                                      | モデル                                 | 理由                             |
| ----------------------------------------- | -------------------------------------- | -------------------------------- |
| 問題生成 (MVP 全般)                       | **`gpt-5`**                            | 品質・コストのバランス           |
| 問題生成 (Phase 2+: senior 以上 / design) | **`gpt-5` + `reasoning_effort: high`** | 必要な時だけコストを上げる       |
| 採点 (mcq, cloze)                         | ロジック処理                           | LLM 不要、完全一致判定           |
| 採点 (short)                              | **`gpt-5-mini`**                       | 安い、ルーブリック判定十分       |
| 採点 (written, code_debug, design)        | **`gpt-5`**                            | 意味理解と部分点                 |
| NL → CustomSessionSpec                    | **`gpt-5-mini`**                       | 低レイテンシ、Structured Outputs |
| 誤概念抽出                                | **`gpt-5`**                            | 精度重要                         |
| Weekly digest                             | **`gpt-5`**                            | 自然な文章                       |

---

## 3.3. 問題生成パイプライン

### 3.3.1. 全体フロー

```
[スケジューラが concept 選定]
        ↓
[プロンプト組み立て]
  - concept 定義
  - difficulty
  - question_type
  - thinking_style
  - 過去の出題履歴サマリ (重複回避)
  - 誤概念タグ (矯正指示)
        ↓
[キャッシュ検索]
  同じ (concept, type, style, difficulty) の過去 30 日未使用を検索
        ↓ hit  → 即返却 (コスト 0)
        ↓ miss
[OpenAI API 呼び出し (Structured Outputs で JSON)]
        ↓
[DB にキャッシュ保存]
        ↓
[ユーザーに表示 (同期、MVP はストリーミングなし)]
```

### 3.3.2. 生成プロンプト (共通テンプレ)

```
<system>
You are a senior engineer creating a quiz question for a professional engineer.
Output strictly as JSON matching the provided schema.
Language: 日本語
</system>

<user>
## Concept
id: {concept.id}
name: {concept.name}
description: {concept.description}
domain: {domain.name}

## Spec
difficulty: {difficulty}        # beginner | junior | mid | senior | staff | principal
question_type: {type}           # mcq | short | written | ...
thinking_style: {style}

## Style instruction
{styleInstructionMap[style]}

## Avoid duplicates
Past recent framings for this concept (last 30 days):
- {q1_summary}
- {q2_summary}

## User context
Recent misconceptions on related concepts:
- {misconception_description}
Target: correct this misconception if relevant.

## Output JSON schema
{
  "prompt": "...",
  "answer": "...",
  "rubric": [...],          // 採点基準 (written/short/design)
  "distractors": [...],     // mcq only
  "hint": "...",
  "explanation": "...",
  "tags": [...]
}
</user>
```

### 3.3.3. Style Instruction Map

真実の源は `src/server/generator/prompts.ts` と `src/db/schema/_constants.ts#THINKING_STYLES`。
MVP は 6 スタイル。

```typescript
// 実装抜粋 (src/server/generator/prompts.ts)。docs 側のコピーは参考。
const STYLE_INSTRUCTION_MAP: Record<ThinkingStyle, string> = {
  why: "問題は「なぜそうなっているか」「理由を説明せよ」形式。表面的な定義を問わないこと。",
  how: "実際の手順や選び方を問う。状況を具体化して実務寄りにすること。",
  trade_off: "複数の選択肢/アプローチの利点と欠点を比較させる問題にすること。",
  edge_case: "通常ケースではなく、境界条件・異常系・稀な条件下の挙動を問うこと。",
  compare: "二つ以上の概念を並べて差を問う。違いが最も本質的な選択肢を正解に。",
  apply: "本番運用で起きうる具体的なシナリオに置き換えて、判断を問うこと。",
};
```

### 3.3.4. キャッシュ戦略

- 生成した問題はすべて `questions` テーブルに保存
- 出題時に 50% はキャッシュから、50% は新規生成 (マンネリ防止と鮮度のバランス)
- **事前生成バッチは MVP では作らない** — 需要発生時のオンデマンド生成で十分
- Phase 5+ で「未充足の組合せを夜間 cron で補充」する余地を残す

---

## 3.4. 採点パイプライン

### 3.4.1. タイプ別の分岐

```
[ユーザー解答受信]
        ↓
question_type で分岐:
  mcq / cloze  → 完全一致判定 (ロジック、LLM 不要)
  short        → gpt-5-mini にルーブリック判定
  written      → gpt-5 にルーブリック + 0-1 スコア
  code_read    → コード実行 (Phase 6 で Judge0)
  code_debug   → gpt-5 判定
  design       → gpt-5 + 対話 (Phase 2+ で最大 3 ターン)
        ↓
[結果保存: attempts テーブル]
        ↓
[誤答時] ユーザーに「なぜそう答えた?」を入力させる (任意、10 秒で終わる UI)
        ↓
[gpt-5 に誤概念抽出依頼] (入力がある場合のみ)
        ↓
[misconceptions テーブル更新]
        ↓
[FSRS に (Again/Hard/Good/Easy) を投入]
        ↓
[mastery テーブル更新]
```

### 3.4.2. 採点プロンプト (written の例)

```
<system>
You are a senior engineer grading an answer. Output strictly as JSON.
</system>

<user>
## Question
{question.prompt}

## Expected answer
{question.answer}

## Rubric (採点基準)
{question.rubric}  // ["必須: SYN-ACK-SYN の順序", "望ましい: 状態遷移に言及"]

## User answer
{user_answer}

## Output schema
{
  "score": 0.75,           // 0.0-1.0
  "rubric_checks": [
    {"item": "SYN-ACK-SYN の順序", "met": true, "note": "..."},
    {"item": "状態遷移に言及", "met": false, "note": "未記述"}
  ],
  "feedback": "...",       // 改善フィードバック
  "strengths": [...],
  "weaknesses": [...],
  "correct": true          // score >= 0.7 を correct とするか、ユーザー設定で
}
</user>
```

### 3.4.3. 採点の反論フロー (MVP 必須)

R1 (誤判定で萎える) は影響度が高い。反論ボタンは MVP 初日から入れる。

1. 採点結果に「これは正解だ」反論ボタン
2. 押下 → 再採点 (同モデルで別プロンプト、`gpt-5-mini` 判定なら `gpt-5` で再評価)
3. 結果に応じて `attempts.correct` と `attempts.score` を更新、判定履歴を残す
4. 反論ログを蓄積 → プロンプト改善の原資
5. 反論されても判定が変わらなかった回数も記録 (プロンプト品質の指標)

---

## 3.5. プロンプトキャッシング (OpenAI 自動)

### 3.5.1. OpenAI の仕組み

OpenAI は **1024 tokens 以上の共通 prefix を自動でキャッシュ**する (手動設定不要)。
キャッシュ hit 時、該当部分の入力コストは半額〜大幅割引。

### 3.5.2. プロンプト構造

```
[CACHED 対象: 共通システムプロンプト + タクソノミ定義 + Style instruction map + JSON schema]
[VARIABLE: 今回の concept / spec / user context]
```

### 3.5.3. 設計注意点

- **設計初日から固定順序で配置**する (prefix が一致しないと自動キャッシュが効かない)
- 共通部は **必ずプロンプトの先頭** に配置、可変部はその後
- キャッシュの TTL は数分〜十数分程度。連続して叩く場面 (Daily Drill 連続出題) で効果が出る
- `user` id パラメータを同じ値で送ると hit 率が上がる傾向あり

---

## 3.6. コスト試算

### 3.6.1. 単価 (2026年4月時点の想定、OpenAI)

| モデル       | 入力 ($/1M) | 出力 ($/1M) | キャッシュ hit 入力 ($/1M) |
| ------------ | ----------- | ----------- | -------------------------- |
| `gpt-5`      | $2.5        | $20         | $0.25                      |
| `gpt-5-mini` | $0.5        | $4          | $0.05                      |

### 3.6.2. 1 問あたりのコスト (概算)

想定: 入力 1500 tokens (キャッシュ hit で実質 200 tokens 相当)、出力 500 tokens

| 操作           | モデル     | コスト/問 |
| -------------- | ---------- | --------- |
| 生成           | gpt-5      | ~$0.012   |
| 採点 (short)   | gpt-5-mini | ~$0.003   |
| 採点 (written) | gpt-5      | ~$0.012   |
| 誤概念抽出     | gpt-5      | ~$0.006   |
| NL パース      | gpt-5-mini | ~$0.001   |

### 3.6.3. 自分用途の 1 ヶ月コスト見積り

想定: 1 日 20 問 × 20 日/月 = 400 問/月、キャッシュ 50% hit

| 項目                              | 月額コスト   |
| --------------------------------- | ------------ |
| 生成 (gpt-5 中心、キャッシュ 50%) | $2.4         |
| 採点 (gpt-5/mini 混在)            | $1.0         |
| NL パース (週数回)                | $0.02        |
| Digest (Phase 3+ 週 1)            | $0.05        |
| **合計**                          | **~$3-4/月** |

個人用途なので API コスト $3-4/月 + インフラ (Neon 無料枠、Vercel Hobby) で **実質 $3-5/月** 程度で回る想定。自己投資として全く許容範囲。

> **コスト暴発対策**: OpenAI ダッシュボードで **Usage limit** を月 $20 に設定する (hard cap)。

---

## 3.7. エージェント機能 (Phase 2+)

API 直叩きで対応できない局面のみ、**軽量エージェント**を自前実装する:

### 3.7.1. ユースケース

- **ユーザーのコードから問題生成** (Phase 2)
  - GitHub リポジトリ連携 → PR/コミットから問題化
  - 必要ツール: ファイル読取、git log 解析、コード実行
- **対話的な設計問題採点** (Phase 2)
  - 答えに対する深掘り質問 (最大 3 ターン)

### 3.7.2. 実装方針

- OpenAI の **Function Calling** + 自前のツール定義
- あるいは **Responses API** で多段ツール呼び出しを組む
- 数十行で書ける軽量な loop、Agents SDK は過剰

---

## 3.8. レート制限と保護

### 3.8.1. 自己抑制

個人用途なので厳密なレート制限は不要だが、以下は設けておく:

- API コストが暴走しないよう、**OpenAI ダッシュボードで Usage limit を $20/月**に設定 (hard cap)
- 1 分に 10 リクエストまでの軽いスロットリング (誤操作でループに入った場合の保険)

### 3.8.2. エラーハンドリング

- API タイムアウト → キャッシュから代替問題を返す
- レート制限時 → 「少し待ってください」UI + 自動リトライ

---

## 3.9. プロンプトのバージョン管理

- プロンプトテンプレは `prompts/` ディレクトリに `.md` で保存
- git で履歴管理
- 各 attempt に `prompt_version` を記録し、どのプロンプトで生成/採点されたか追跡可能に
- プロンプト改善時は、自分の使用感を見ながら反復的に調整
