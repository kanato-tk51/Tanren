# 03. AI 活用戦略

Tanren は Anthropic の **Claude API** を中核とする。問題生成、採点、NL パース、誤概念抽出など、すべての AI 処理を API 経由で行う。Claude Code / Codex のようなエージェント型ツールはバックエンドには使わない。

---

## 3.1. 基本方針

### なぜ Web API 一択か

1. **単一 API 呼び出し = 単一問題** で設計がシンプル、デバッグ容易、再現性が高い
2. **レイテンシが低い** (数秒〜10秒程度)。エージェント型は 30秒〜分かかる
3. **コストが桁違いに低い** (エージェント型は 10-100 倍)
4. **サーバーサイドで安定運用できる** (Claude Code/Codex は CLI 前提)
5. **プロンプトキャッシングが使える** (90% 割引)

### Claude Code / Codex を使わない理由

- コーディング作業のためのエージェントで、問題生成には過剰
- multi-tenant サーバー上で並列実行する設計になっていない
- 毎問ごとにエージェントループを走らせるのはオーバーキル

---

## 3.2. モデル選定

用途ごとに Haiku / Sonnet / Opus を使い分ける。

| 用途 | モデル | 理由 |
|---|---|---|
| 問題生成 (定型: mcq, short, cloze) | **Claude Sonnet 4.6** | コスパ良い、品質十分 |
| 問題生成 (高難度: written, design, edge_case) | **Claude Opus 4.7** | 推論の質が段違い |
| 採点 (mcq, cloze) | ロジック処理 | LLM 不要、完全一致で判定 |
| 採点 (short) | **Claude Haiku 4.5** | 安い、ルーブリック判定には十分 |
| 採点 (written, code_debug, design) | **Claude Sonnet 4.6** | 意味理解と部分点の精度 |
| NL → CustomSessionSpec パース | **Claude Haiku 4.5** | 低レイテンシ、構造化出力 |
| 誤概念抽出 | **Claude Sonnet 4.6** | 微妙な誤解を捉える精度 |
| Weekly digest 生成 | **Claude Sonnet 4.6** | 自然な文章 |

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
[Claude API 呼び出し (JSON 構造化出力)]
        ↓
[DB にキャッシュ保存]
        ↓
[ユーザーに表示 (ストリーミング)]
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
difficulty: {difficulty}        # intro | applied | edge_case
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

```typescript
const styleInstructionMap = {
  why: "問題は『なぜそうなっているか』『理由を説明せよ』形式。表面的な定義を問わないこと。",
  trade_off: "複数の選択肢/アプローチの利点と欠点を比較させる問題にすること。",
  debugging: "実際のコードやエラーログを提示し、問題箇所と原因を特定させること。",
  applied_scenario: "本番運用で起きうる具体的シナリオ (例: 深夜3時にアラートが…) を設定すること。",
  edge_case: "通常ケースではなく、境界条件・異常系・稀な条件下の挙動を問うこと。",
  historical: "技術の背景・設計判断の歴史的経緯を問うこと。",
  // ...
};
```

### 3.3.4. キャッシュ戦略

- 生成した問題はすべて `questions` テーブルに保存
- 出題時に 50% はキャッシュから、50% は新規生成 (マンネリ防止と鮮度のバランス)
- 事前生成バッチ (夜間 cron): 未充足の `(concept, type, style, difficulty)` 組合せを埋める

---

## 3.4. 採点パイプライン

### 3.4.1. タイプ別の分岐

```
[ユーザー解答受信]
        ↓
question_type で分岐:
  mcq / cloze  → 完全一致判定 (ロジック)
  short        → Haiku にルーブリック判定
  written      → Sonnet にルーブリック + 0-5 スコア
  code_read    → コード実行 (Phase 2 で Judge0)
  code_debug   → Sonnet 判定
  design       → Sonnet + 対話 (最大 3 ターン)
        ↓
[結果保存: attempts テーブル]
        ↓
[誤答時] ユーザーに「なぜそう答えた?」を入力させる (任意、10 秒で終わる UI)
        ↓
[Sonnet に誤概念抽出依頼]
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

### 3.4.3. 採点の反論フロー

ユーザーが「これは正解だ」と反論可能:
1. 反論ボタン → 再採点 (別モデルで再評価、例: Haiku の判定に Sonnet で再評価)
2. 結果に応じて `attempts.correct` を更新
3. 反論ログを蓄積 → プロンプト改善の原資

---

## 3.5. プロンプトキャッシング

### 3.5.1. 何をキャッシュするか

Claude API の `cache_control` 機能で、以下を長期キャッシュ:

- 知識タクソノミの定義 (全 concept のメタ情報)
- 採点ルーブリックの雛形
- Style instruction map
- JSON schema 定義

### 3.5.2. プロンプト構造

```
[CACHED: 共通システムプロンプト + タクソノミ定義]  ← 90% 割引
[CACHED: スタイル指示マップ]                        ← 90% 割引
[VARIABLE: 今回の concept / spec / user context]   ← 通常料金
```

### 3.5.3. 設計注意点

- **設計初日から固定順序で配置**する (後付けでの組み直しは高コスト)
- キャッシュキーはプロンプトの先頭から一致する部分で決まる → 共通部を必ず先頭に
- 24時間以上使わないとキャッシュが消える → 定期リクエストで維持 (cron で wake up)

---

## 3.6. コスト試算

### 3.6.1. 単価 (2026年4月時点の想定)

| モデル | 入力 ($/1M tokens) | 出力 ($/1M tokens) |
|---|---|---|
| Haiku 4.5 | $1 | $5 |
| Sonnet 4.6 | $3 | $15 |
| Opus 4.7 | $15 | $75 |

プロンプトキャッシュ hit 時は入力が 90% 割引。

### 3.6.2. 1問あたりのコスト

想定: 入力 1500 tokens (キャッシュ hit で実質 150 tokens)、出力 500 tokens

| 操作 | モデル | コスト/問 |
|---|---|---|
| 生成 (定型) | Sonnet | ~$0.008 |
| 生成 (高難度) | Opus | ~$0.040 |
| 採点 (short) | Haiku | ~$0.002 |
| 採点 (written) | Sonnet | ~$0.008 |
| 誤概念抽出 | Sonnet | ~$0.004 |
| NL パース | Haiku | ~$0.001 |

### 3.6.3. 1ユーザー/月のコスト

想定: 1日 20 問 × 20 日/月 = 400 問/月、キャッシュ 50% hit

| 項目 | 月額コスト |
|---|---|
| 生成 (Sonnet 中心、キャッシュ 50%) | $1.60 |
| 採点 (Haiku/Sonnet 混在) | $0.80 |
| NL パース (週2回) | $0.02 |
| Digest (週1) | $0.05 |
| **合計** | **~$2.5/ユーザー/月** |

### 3.6.4. 収支の想定

- サブスク $10/月 の場合、API 原価 $2.5 → 粗利率 **75%**
- その他インフラ (Turso, Vercel, PostHog, Clerk) で $0.5-1/ユーザー/月程度
- 実質粗利 **60-70%**

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

- Anthropic の **Tool Use API** + 自前のツール定義
- Claude Code/Codex は使わない (前述の理由)
- 数十行で書ける軽量な loop

---

## 3.8. レート制限と保護

### 3.8.1. ユーザー単位

- Free: 1日 10 問まで
- Pro: 無制限 (ただし 1分10問でレート制限 = 悪用防止)

### 3.8.2. サーバー単位

- Upstash Redis でグローバルレート制限
- Anthropic API の回線は複数キーで負荷分散 (必要になれば)

### 3.8.3. エラーハンドリング

- API タイムアウト → キャッシュから代替問題を返す
- レート制限時 → 「少し待ってください」UI + 自動リトライ

---

## 3.9. プロンプトのバージョン管理

- プロンプトテンプレは `prompts/` ディレクトリに `.md` で保存
- git で履歴管理
- プロンプト変更時は A/B テストで効果検証 (PostHog feature flag)
- 各 attempt に `prompt_version` を記録し、どのプロンプトで生成/採点されたか追跡可能に
