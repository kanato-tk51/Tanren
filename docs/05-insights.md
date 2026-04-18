# 05. Insights モジュール

ユーザーが自分の学習状態を把握し、次に取るべき行動を判断するための機能群。

---

## 5.1. 設計思想

### 5.1.1. 避けたいパターン

- ❌「今週正答率 73%」 → 見ても「だから何?」
- ❌「連続 14 日 🔥」 → やる気だけで行動につながらない

### 5.1.2. 目指すパターン

- ✅「**並行性系の問題を 8 回連続で落としている** — 根本は race condition の概念ズレ」
- ✅「**ネットワーク分野を 3 週間触れていない** — 以前 80% だった TCP が減衰中」
- ✅「**edge_case 型は強いが apply 型は 40%** — 座学はできるが現場対応が弱い」

すべての指標は**「次の行動」に直結する問い**とセットで見せる。

---

## 5.2. 画面構成 (7つ)

| 画面           | ルート                     | 機能                                          |
| -------------- | -------------------------- | --------------------------------------------- |
| Dashboard      | `/insights`                | 全体サマリ + Top3 強み / 弱点 / 盲点 / 忘却中 |
| Mastery Map    | `/insights/map`            | 知識ツリーのビジュアル化 (サンバースト)       |
| History        | `/insights/history`        | 時系列の解答履歴 + フィルタ                   |
| Search         | `/insights/search`         | 全文検索 (問題文 / 回答 / 解説)               |
| Domain Detail  | `/insights/domain/[id]`    | 分野深掘り (正答率 / 思考型別)                |
| Misconceptions | `/insights/misconceptions` | 誤概念トラッカー                              |
| Trends         | `/insights/trends`         | 時系列グラフ (正答率推移など)                 |

---

## 5.3. Dashboard `/insights`

### 表示内容

```
┌──────────────────────────────────────────┐
│ Your Learning, Today                     │
├──────────────────────────────────────────┤
│ Mastery: 62 / 240 concepts               │
│ ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░  26%          │
│                                          │
│ 📈 Strongest (top 3)                     │
│   1. Git 内部 (94%)                      │
│   2. SQL Join (91%)                      │
│   3. プロセス/スレッド (87%)              │
│                                          │
│ ⚠️  Weakest (需改善 top 3)                │
│   1. 分散合意 (32%) — 8問中 5問ミス       │
│   2. TLS (41%) — 誤概念「RSA 鍵交換」多発 │
│   3. キャッシュコヒーレンス (44%)          │
│                                          │
│ 🚧 Blind Spots (未着手 top 3)             │
│   1. DNSSEC — 0 問                        │
│   2. Paxos — 0 問                         │
│   3. BGP — 0 問                           │
│                                          │
│ 📉 Decaying (忘却進行中)                  │
│   - TCP 輻輳制御: 最終 23 日前、マスタ低下  │
│                                          │
│ [すべての分野を見る] [履歴検索]            │
└──────────────────────────────────────────┘
```

### 設計意図

- 画面を開くだけで **「次に何を強化すべきか」が分かる**
- 各項目から1タップで該当 concept だけの Custom Session を開始可能

---

## 5.4. Mastery Map `/insights/map`

### ビジュアル案

- **サンバースト図** or **ツリーマップ**
- 中心にドメイン、外側にサブドメイン → 概念
- **色**で mastery を表現:
  - 灰: 未着手
  - 赤: 苦手 (mastery < 40%)
  - 黄: 中 (40-80%)
  - 緑: 習得 (80%+)
- **面積**: その concept に費やした問題数
- タップで concept 詳細にドリルダウン

```
                ╭─ OS (68%) ─╮
               │              │
               │   Memory     │  ← 緑 (習得)
               │   Process    │  ← 黄 (中)
               │   Scheduling │  ← 灰 (未着手)
               │              │
  Network (54%)╰─  DB (71%) ─╯
```

### 実装 (issue #29, Phase 5+)

- **依存ゼロの自作 SVG sunburst** (`src/features/insights/mastery-map-screen.tsx`)
  - Recharts / D3 は追加しない方針 (CLAUDE.md §3: ライブラリ追加は最小限)。
  - 3 リング構成: 中心=domain / 中層=subdomain / 外層=concept。
  - 面積は `attempt_count + 1` smoothing (未着手 concept も目視できる大きさを確保)。
  - 色は 4 tier (untouched/weak/mid/mastered、docs §5.4 の定義通り)。
  - 外層 concept のタップで `/custom?conceptId=...` にドリルダウン (Custom Session で単一 concept を出題)。
- 集計ロジックは `src/server/insights/mastery-map.ts` の `fetchMasteryMap`。
  Insights overview と同じ 3 テーブル結合を使うが、Top N ではなく階層全体を返す。
- `/insights/map` ルート (`src/app/insights/map/page.tsx`) で SSR 認証チェック + mount。
- Insights Dashboard の「Your Learning, Today」カードに「🗺 Mastery Map を開く」導線を追加。

---

## 5.5. History `/insights/history`

時系列で過去の解答をすべて閲覧・検索・フィルタできる。

```
┌──────────────────────────────────────────┐
│ 🔍 [検索語...]                           │
│ Filters: [分野▾] [期間▾] [正誤▾] [型▾] │
├──────────────────────────────────────────┤
│ 2026-04-17 09:22                         │
│ TLS 1.3 で 0-RTT を使うリスクは?        │
│ 分野: network > tls  型: why  難: senior │
│ あなた: "リプレイ攻撃のリスク"           │
│ 結果: ◐ 部分正解 (2/3)                   │
│ [詳細] [類題を出す] [復習キューに追加]   │
│ ─────────────────────────                │
│ 2026-04-17 09:20                         │
│ ... (続き)                                │
└──────────────────────────────────────────┘
```

### フィルタ

- 分野 / サブドメイン / concept
- 期間 (今日/今週/今月/指定範囲)
- 正誤 (正解 / 部分正解 / 誤答)
- 問題タイプ / 思考スタイル
- 難易度
- セッション種別 (Daily / Deep / Custom / Review)

### 各エントリのアクション

- `[詳細]` — 解説・ルーブリック・採点詳細を展開
- `[類題を出す]` — 同じ concept で別の角度の問題を今すぐ生成
- `[復習キューに追加]` — `next_review` を翌日に前倒し

---

## 5.6. Search `/insights/search`

過去の問題文・自分の回答・解説から横断的に全文検索。

### 実装

**MVP (issue #22)**: `ILIKE '%q%'` ベースで attempts (user_answer / feedback) /
questions.prompt / misconceptions.description を横断検索。
`src/server/insights/search.ts` に集約。SQL injection 対策は drizzle の
`ilike()` / `eq()` による prepared statement bind で担保 (unit test あり)。

**Phase 5+ (issue #30)**: `tsvector` + GIN + `pg_trgm` を併用した本格チューニング **実装済み**。
真実の源は `src/server/insights/search.ts` と migration `drizzle/0010_search_indexes.sql`。

**現在のインデックス構成 (issue #30):**

| テーブル         | カラム                   | 種別               | 用途                    |
| ---------------- | ------------------------ | ------------------ | ----------------------- |
| `attempts`       | `search_tsv` (generated) | GIN (tsvector)     | 英数トークン @@ tsquery |
| `attempts`       | `user_answer`            | GIN (gin_trgm_ops) | ILIKE 加速 (CJK 対応)   |
| `attempts`       | `feedback`               | GIN (gin_trgm_ops) | ILIKE 加速              |
| `questions`      | `search_tsv` (generated) | GIN (tsvector)     | 英数トークン @@ tsquery |
| `questions`      | `prompt`                 | GIN (gin_trgm_ops) | ILIKE 加速              |
| `misconceptions` | `search_tsv` (generated) | GIN (tsvector)     | 英数トークン @@ tsquery |
| `misconceptions` | `description`            | GIN (gin_trgm_ops) | ILIKE 加速              |

**検索戦略 (`fetchSearch`):**

1. クエリに ASCII 英数字が含まれる場合: `search_tsv @@ plainto_tsquery('simple', q)` を OR 条件に追加
   (GIN tsvector 索引で定数時間マッチ、attempts / questions / misconceptions すべて対応)
2. 常に `ILIKE '%q%'` を OR 条件に残す (日本語 / CJK のフォールバック、pg_trgm GIN 索引で加速)
3. 両経路を `OR` で結合して単一 SQL で実行 (Postgres プランナが最良索引を選ぶ)

### UX

```
q: "race condition"
→ 12 hits
    [OS > 並行性] 3問 (正答率 33%) ← 弱点!
    [DB > トランザクション] 5問 (80%)
    [言語 > Rust] 4問 (100%)

→ 「ここ弱いから復習する?」ボタン
```

### 日本語対応

- PostgreSQL 標準 parser は日本語で弱い
- **`pg_trgm` GIN index** (trigram 部分一致) を主軸に据えるのが実用的
- より本格的には `pgroonga` / `textsearch_ja` 拡張、または Meilisearch/Typesense を別立て (Phase 2+)

---

## 5.7. Domain Detail `/insights/domain/[id]`

1 つの分野を深掘り。

```
Domain: Network (54% mastery)
─────────────────────────────────
Attempted: 87 problems
Correct:   47 (54%)
Avg time:  1m 23s

Sub-domains:
  TCP/IP     ▓▓▓▓▓▓▓▓▓░  82%   (22 problems)
  TLS        ▓▓▓▓░░░░░░  41%   (17 problems) ⚠️
  DNS        ▓▓▓▓▓▓▓░░░  71%   (12 problems)
  HTTP/2     ▓▓░░░░░░░░  25%   (3 problems)
  BGP        ░░░░░░░░░░   -    (0 problems)  未着手

Thinking style breakdown:
  why:          73% ✓
  trade_off:    68% ✓
  edge_case:    38% ⚠️  ← この分野×この思考型が弱い
  apply:        52%

Recent attempts: [リスト]
Misconceptions tracked: [リスト]
```

### 得られる気付き

- 「この分野全体は OK でも特定のサブドメインだけ弱い」
- 「この分野は定義は覚えてるが edge_case 型の問題が苦手」

---

## 5.8. Misconceptions `/insights/misconceptions`

繰り返し間違える誤概念を診断。

```
🧠 Recurring Misconceptions

1. "TLS の鍵交換は常に RSA"        [4回]
   ↳ 実際: TLS 1.3 は RSA 鍵交換を廃止
   ↳ 関連 concept: network.tls.key_exchange
   ↳ [この概念を集中学習]

2. "JOIN は必ずインデックスを使う"  [3回]
   ↳ 実際: optimizer が seq scan を選ぶケース多数
   ↳ [集中学習]

3. "GIL があるから Python は並列処理できない" [2回]
   ↳ 実際: I/O bound なら並行可、CPU bound は multiprocessing
```

### 仕組み

1. 採点時に「正しい答え」と「ユーザーの答え」の差を `gpt-5` が分析
2. 誤概念の要旨を `misconceptions` テーブルに保存
3. 同じ誤概念が再発したら `count` を加算
4. 矯正できたら `resolved = 1` にマーク

### 生成プロンプトへの注入

出題時、関連する concept の誤概念があれば:

```
## User context
Recent misconceptions on this concept:
- "TLS の鍵交換は常に RSA" (reported 4 times, unresolved)

Generate a question that would reveal or correct this misconception.
```

→ 矯正を狙った問題が出る

---

## 5.9. Trends `/insights/trends`

時系列の変化をグラフで可視化。

```
Weekly mastery growth:
[折れ線グラフ: 縦軸 concept 数, 横軸 週]

Accuracy by difficulty over time:
  beginner:  ━━━━━━━━━━━ 95%
  junior:    ━━━━━━━━━━  88%
  mid:       ━━━━━━━╱    72% ↑ (改善中)
  senior:    ━━━━╲╱      48% ↓ (停滞)

Study time:
  平日 avg: 12 min
  休日 avg: 35 min

Domain coverage:
  [棒グラフ: ドメインごとの総 attempt 数]
```

### 実装

- **Recharts** で折れ線 / 棒 / 面グラフ
- Phase 2 以降 (MVP では Trend は省略)

---

## 5.10. 派生メトリクスの定義

| 名称            | 定義                                     |
| --------------- | ---------------------------------------- |
| `mastery_pct`   | 習得済 (`mastered = 1`) / 全 concept     |
| `weakest`       | ≥5 attempt で正答率が低い concept 順     |
| `blind_spot`    | prereq 全て習得済 AND attempt_count = 0  |
| `decaying`      | stability が初回より下がっている concept |
| `consistency`   | 直近30日で学習した日数 / 30              |
| `style_profile` | 思考スタイル別の正答率プロファイル       |
| `type_profile`  | 問題タイプ別の正答率プロファイル         |

---

## 5.11. プロアクティブ通知

「見に行かないと気付かない」を防ぐ仕組み。

### 通知種別

| 種類                | タイミング       | 条件                               | 配信 (MVP 以降)     |
| ------------------- | ---------------- | ---------------------------------- | ------------------- |
| Daily reminder      | ユーザー指定時刻 | `next_review <= today` が N 問以上 | メール (Phase 3+)   |
| Blind spot unlocked | 任意             | prereq 完了時                      | アプリ内 (Phase 3+) |
| Weekly digest       | 日曜 9:00        | 毎週                               | メール (Phase 3+)   |
| Decay warning       | 任意             | 主要 concept で stability 30% 低下 | アプリ内 (Phase 3+) |

Web Push は Phase 5+、`07.5.5` の検証後。Streak at risk は Streak 自体をやらないため無し。

### Weekly Digest の内容例

```
先週の学び (4/14-4/20)

✅ 成長
  - OS メモリ管理: 62% → 78% (+16pt)
  - 分散合意アルゴリズム: 新たに Raft を習得

⚠️  停滞
  - Network TLS: 41% のまま、4 回 attempt 中 3 回ミス
  - 誤概念「TLS の鍵交換は常に RSA」が 3 回繰り返し

🚧 未着手
  - Paxos (前提 Quorum を習得済み、今週試せます)
  - DNSSEC

提案: 今週は TLS を集中学習するカスタムセッションを試しませんか?
[TLS Deep Dive を開始]
```

生成は `gpt-5` で。

---

## 5.12. Insights から行動への接続

すべての気付きが「行動」に直結するボタンを持つ。

| 気付き         | ボタン                           | アクション                   |
| -------------- | -------------------------------- | ---------------------------- |
| 弱点 concept   | 「この concept だけ再出題」      | Custom Session 自動生成      |
| Blind Spot     | 「試してみる」                   | Daily Drill に 1 問混入      |
| 誤概念         | 「この誤解を矯正する問題を出す」 | 矯正指示付きで生成           |
| Decaying       | 「復習キューに追加」             | `next_review` を翌日に前倒し |
| Style weakness | 「このスタイルで練習」           | Custom Session で指定        |

---

## 5.13. MVP での Insights スコープ

### 5.13.1. MVP に含める

- Dashboard (数値のみ、グラフなし)
- History 画面 (時系列一覧 + 基本フィルタ: 分野・正誤)
- Domain Detail (テキスト表形式)
- Search (LIKE 句レベル、FTS は後)

### 5.13.2. Phase 2 で追加

- Mastery Map のビジュアル (サンバースト)
- Misconception Tracker (誤概念タグ付けインフラが Phase 2)
- Trends グラフ
- Weekly Digest 生成 + 配信
- tsvector + pg_trgm の本格チューニング (現在は最小構成)
- 全ての「行動につなぐボタン」の実装

---

## 5.14. データ量の見積もり

- 1 ユーザーが 1 年間 1 日 20 問 = **~7,300 attempts**
- 1 attempt ≈ 2 KB → **~15 MB/ユーザー/年**
- Neon 無料枠 (0.5GB) で余裕で処理可能
- tsvector + GIN 検索も数 ms 以内
