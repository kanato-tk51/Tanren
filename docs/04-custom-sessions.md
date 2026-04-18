# 04. カスタムセッション

ユーザーが「こういう問題を出して」と自然言語で指定できる機能。Tanren の差別化の要。

---

## 4.1. 目的

- 学習者自身が出題をコントロールできる
- 面接対策、業務で必要になった分野、苦手克服など、個別ニーズに応える
- LLM の「任意の角度で問える」強みを最大限に活かす

---

## 4.2. 入力方法 (2レイヤ)

### レイヤ A: 自然言語プロンプト (メイン入口)

```
「TCP の輻輳制御について、なぜそうなっているかを問う
 senior レベルの問題を 5 問出して」
```

→ LLM にパースさせて構造化リクエストに変換

### レイヤ B: 構造化フィルタ (微調整 UI)

パース結果をフォームで表示し、ユーザーが微調整可能:

```
┌────────────────────────────────┐
│ 🎯 Custom Session              │
├────────────────────────────────┤
│ 自由記述:                      │
│ [TCP の輻輳制御について...   ] │
│                                │
│ ─── パース結果 (編集可) ───    │
│ 分野:   [Network > TCP ▾]      │
│ 概念:   [輻輳制御] + [追加]    │
│ 思考型: [なぜ ▾]               │
│ 問題形式: [記述 ▾] + [コード] │
│ 難易度: ●━━━━○━━━ Senior     │
│ 問題数: [ 5 ]                  │
│                                │
│ [プレビュー] [開始 ▶]          │
└────────────────────────────────┘
```

---

## 4.3. CustomSessionSpec のスキーマ

真実の源は `src/server/parser/schema.ts` の `CustomSessionSpecSchema` (Zod)。
MVP では**未指定フィールドは全て omit** する方針 (§4.4.2 参照)。
したがって UI / セッション開始ロジック側で既定値を補完する責務を持つ。
命名は実装に合わせて camelCase。

```typescript
type CustomSessionSpec = {
  // 範囲 (すべて optional)
  domains?: DomainId[]; // ['os', 'network']
  subdomains?: string[]; // ['network.tcp']
  concepts?: string[]; // ['network.tcp.congestion']
  excludeConcepts?: string[];

  // 思考スタイル (複数選択可、未指定なら omit)
  thinkingStyles?: ThinkingStyle[];

  // 問題形式 (未指定なら omit)
  questionTypes?: QuestionType[];
  questionCount?: number; // int 1..20 (schema.ts 制約)。未指定なら UI 側で既定 5 を補完

  // 難易度 (MVP は absolute のみ)
  difficulty?: DifficultySpec;

  // 制約
  constraints?: {
    language?: "ja" | "en";
    codeLanguage?: string;
    timeLimitSec?: number; // int 5..3600 (schema.ts 制約)
    mustInclude?: string[]; // 「必ず TLS 1.3 を含めて」
    avoid?: string[]; // 「OSI 参照モデルは避けて」
  };

  // FSRS 連動 (未指定なら UI 側で true と解釈)
  updateMastery?: boolean;
};

// MVP の実装型 (src/db/schema/_constants.ts THINKING_STYLES と同期)。
// 当初 docs で挙げていた memorization / design / code_reading などの細粒度は
// Phase 5+ 以降で追加検討。MVP は 6 スタイルに圧縮している。
type ThinkingStyle =
  | "why" // なぜそうなっているか
  | "how" // どう動くか / 手順
  | "trade_off" // 選択肢の比較検討
  | "edge_case" // 例外 / 罠 / 境界
  | "compare" // 2 者の違いを説明
  | "apply"; // 実務適用 / シナリオ

// MVP は absolute のみ。relative / numeric / interview は Phase 5+。
type DifficultySpec = {
  kind: "absolute";
  level: "beginner" | "junior" | "mid" | "senior" | "staff" | "principal";
};
```

---

## 4.4. NL → Spec パーサ

### 4.4.1. 使用モデル

**OpenAI `gpt-5-mini`** — Structured Outputs が速く安い (ADR-0005)。

### 4.4.2. パーサプロンプト

```
<system>
You are a request parser for a learning app.
Convert the user's natural-language request into a CustomSessionSpec JSON.
</system>

<user>
## User request
"{raw}"

## Available domains
[programming, dsa, os, network, db, security, distributed, design,
 devops, tools, low_level, ai_ml, frontend]

## Available thinking styles
[why, how, trade_off, edge_case, compare, apply]

## Rules
- If a field is not mentioned, omit it (don't invent). 既定値は UI 側で補完する。
- Map vague Japanese:
    「深く考える」 → thinkingStyles: ["why", "trade_off"]
    「基礎」       → difficulty.level: junior (thinkingStyles は omit)
    「面接レベル」 → senior + thinkingStyles: ["trade_off", "edge_case"]
    「実務的」     → thinkingStyles: ["apply"]
    「違いを比べて」 → thinkingStyles: ["compare"]
    「エッジケース」「罠」 → thinkingStyles: ["edge_case"]

## Output
Strict JSON matching CustomSessionSpec schema.
</user>
```

### 4.4.3. パース結果のユーザー確認

- パース結果をフォームに展開して表示
- 「ここを直して」→ 自然言語で再入力 → 再パース
- または直接フォームで編集

---

## 4.5. 問題生成への注入

通常の生成プロンプト (`03-ai-strategy.md` 参照) に `thinking_style` を明示的に指示する。

```
## Spec (Custom Session)
difficulty: senior
question_type: written
thinking_style: why
user_constraint: "必ず TLS 1.3 の挙動を含めて"
```

---

## 4.6. 難易度キャリブレーション

### 4.6.1. 絶対難易度 (beginner / junior / mid / senior / staff / principal)

プロンプトで LLM にレベルごとの具体的な基準を指示:

```
Beginner level means:
- 用語の定義・基本的な仕組みを問う
- 具体例と合わせて理解を確認する
- コード例を読ませる場合も短く単純に
- 他の概念に依存しない単一テーマ

Junior level means:
- 定義に加え、典型的な使い方を問う
- よくある勘違い・罠を扱う
- 簡単な応用シナリオを設定する

Senior level means:
- 前提知識を深く掘る (「なぜ TCP は輻輳制御をフロー制御と分離したか?」)
- 複数概念の交差を問う (「TLS handshake と TCP Nagle の相互作用は?」)
- 実装/運用トレードオフを問う
- 「とりあえず動く」答えでは満点にしない
```

### 4.6.2. 相対難易度 (+1, -1 など)

ユーザーの mastery から「今の到達レベル」を推定し、そこから相対で指定:

- 該当 concept の現在到達レベルが `junior` のとき
- `+1` 指定 → `mid`
- `+2` 指定 → `senior`
- `-1` 指定 → `beginner`

到達レベルの推定は `mastery_pct` と直近の successful difficulty から。

### 4.6.3. 面接難易度 (interview)

```
FAANG interview level:
- 1問 45-60 分を想定
- 複数の正解があり、トレードオフを議論させる
- フォローアップ質問を想定した深い記述
```

---

## 4.7. UX フロー

```
[Custom Session 入口]
        ↓
[自然言語入力]
        ↓
[パース・プレビュー] — 解釈結果を表示 + サンプル1問を生成して見せる
        ↓           ↓
    [OK]         [修正]→ フォームで再調整 → ループ
        ↓
[セッション開始]
        ↓
N 問生成 → 出題 → 採点 (通常ループと同じ)
        ↓
[セッション保存?] → 名前付けて Template に → 後で再利用可能
```

---

## 4.8. Templates (再利用)

よく使う指定は保存できる。

```
📁 My Templates
  ├─ TLS 深掘り (5問、記述、senior、trade_off)
  ├─ 分散システム面接対策 (10問、staff、trade_off + edge_case)
  ├─ 今週作ったコードから出題 (Phase 2)
  └─ SQL パフォーマンス (apply + edge_case)
```

### 4.8.1. Template の構造

```sql
CREATE TABLE session_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT,
  raw_request TEXT,               -- 元の自然言語
  spec TEXT NOT NULL,             -- CustomSessionSpec JSON
  use_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER
);
```

### 4.8.2. 共有機能 (Phase 2)

- テンプレートを URL で共有 → 他ユーザーがインポート
- 「シニアエンジニア向けテンプレート集」のような人気テンプレを紹介

---

## 4.9. FSRS との連携

### 4.9.1. デフォルト: mastery に反映

`updateMastery: true` の場合:

- Custom Session の結果も FSRS に投入
- Mastery が更新される

### 4.9.2. オプション: 成績を記録しない

`updateMastery: false` の場合:

- 「お試しモード」として気楽に難問を試せる
- 履歴には残るが FSRS には影響しない

### 4.9.3. 未登録 concept の扱い

Custom で「存在しない concept (例: `network.tcp.bbrv2`)」が出たら:

1. **動的に concept ノードを追加** → mastery tracking 対象にするか確認
2. ユーザー承認後、知識ツリーに組み込む

この仕組みで、**ユーザーの興味に沿って知識ツリーが成長**する。

---

## 4.10. MVP 段階での範囲

### 4.10.1. MVP に含める

- 自然言語入力 1 個
- `gpt-5-mini` によるパース
- **パース結果を読み取り専用カードで表示** (違和感あれば自然言語で再入力)。編集可能フォームは MVP では作らない
- 既存生成プロンプトへの `thinking_style` 注入
- 絶対難易度のみサポート (`beginner / junior / mid / senior`)

### 4.10.2. Phase 2 で追加

- フォームでの微調整 UI
- Template 保存・再利用
- 相対難易度 / 面接難易度
- 動的 concept 追加
- Template 共有 URL
