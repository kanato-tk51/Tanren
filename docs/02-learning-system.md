# 02. 学習システム

Tanren の中核は「概念 (concept) × 問題タイプ × 思考スタイル」の掛け合わせで出題し、Spaced Repetition で記憶を定着させる仕組み。

---

## 2.1. 知識タクソノミ (Concept Tree)

知識を階層構造で整理し、概念 (concept) 単位で mastery を追跡する。

### 2.1.1. 初期ドメイン (11 ドメイン想定、MVP は 5-6 ドメインから)

```
domains:
  - programming   # 言語基礎、型、スコープ、メモリ管理、エラー処理、関数型/OOP
  - dsa           # データ構造、アルゴリズム、計算量
  - os            # プロセス、スレッド、メモリ管理、スケジューリング、I/O、並行性
  - network       # TCP/IP、HTTP、TLS、DNS、WebSocket、REST、gRPC
  - db            # RDB、NoSQL、トランザクション、インデックス、クエリ最適化
  - security      # 認証/認可、暗号、OWASP、脅威モデリング
  - distributed   # CAP、合意、レプリケーション、シャーディング、スケーリング
  - design        # 設計パターン、アーキテクチャ、DDD、テスト戦略、SOLID
  - devops        # Docker、Kubernetes、CI/CD、クラウド、観測性
  - tools         # Git 内部、Linux/シェル、エディタ、デバッガ、パッケージマネージャ
  - low_level     # アセンブリ、キャッシュ、メモリモデル、コンパイラ (応用)
```

### 2.1.2. ドメインの優先度 (beginner/junior 向け)

MVP 開始時点で扱うドメインを段階的に広げる:

| 優先度 | ドメイン | 理由 |
|---|---|---|
| **Tier 1 (必須)** | programming, dsa, network, db, tools | 日常の開発で毎日触る領域 |
| **Tier 2 (次点)** | os, security, design, devops | 数年以内に必ず必要になる |
| **Tier 3 (応用)** | distributed, low_level | 深い理解が必要になる段階で |

**MVP では Tier 1 の 5 ドメインから開始**、順次 Tier 2 に拡張。Tier 3 は Phase 2 以降。

### 2.1.3. Concept の定義 (YAML シード例)

```yaml
- id: network.tcp.congestion
  name: TCP 輻輳制御
  description: 輻輳を検知し送信レートを調整する仕組み
  domain: network
  subdomain: tcp
  prereqs:
    - network.tcp.basics
    - network.tcp.flow_control
  difficulty_levels: [intro, applied, edge_case]
  tags: [throughput, reliability, congestion-control]
```

### 2.1.4. Concept の構成要素

| 要素 | 説明 |
|---|---|
| `id` | 階層的な ID (`<domain>.<subdomain>.<name>`)、unique |
| `name` | 人間向けの名称 |
| `description` | 短い説明 (問題生成時のコンテキスト) |
| `prereqs` | 前提となる concept の ID リスト |
| `difficulty_levels` | サポートする難易度 (intro / applied / edge_case) |
| `tags` | 横串のラベル (「並行性」「セキュリティ」など分野横断) |

### 2.1.5. 前提 (prereqs) の役割

- **未習の前提がある concept は出題候補から除外**
- 前提を全部習得すると concept が「解禁」される
- これにより知識ツリーが自然に広がっていく体験を作る

---

## 2.2. 問題タイプ

同じ concept を複数のタイプで問うことで、異なる記憶経路を刺激する。

| タイプ (`question_type`) | 説明 | 例 |
|---|---|---|
| `mcq` | 4択 | TCP 輻輳制御のアルゴリズムを選ぶ |
| `short` | 短答 (1-2 文) | 「Zombie プロセスとは?」 |
| `written` | 記述 (数段落) | 「Paging と Segmentation の違いを比較せよ」 |
| `cloze` | 穴埋め | `SELECT * FROM users WHERE id = ___` |
| `code_read` | コード読解 | 「このコードの出力は?」 |
| `code_debug` | デバッグ | 「このコード/ログの問題箇所は?」 |
| `design` | ミニ設計 | 「短縮URL サービスのスキーマを設計」 |

### 2.2.1. 問題タイプと採点難度の対応

| タイプ | 採点方法 | 採点 LLM |
|---|---|---|
| `mcq` / `cloze` | 完全一致 | 不要 |
| `short` | ルーブリック項目の充足判定 | Haiku |
| `written` | ルーブリック + 0-5 スコア + 改善点生成 | Sonnet |
| `code_read` | 実行結果比較 (Phase 2: Judge0) | 不要 or Haiku |
| `code_debug` | 修正内容の妥当性判定 | Sonnet |
| `design` | 対話採点 (最大3ターン) | Sonnet |

---

## 2.3. 思考スタイル (Thinking Style)

同じ concept でも「問い方の角度」を変えることで学習効果が上がる。

| スタイル (`thinking_style`) | 問う観点 | 例 (concept: 3-way handshake) |
|---|---|---|
| `memorization` | 定義・暗記 | 「3-way handshake の3つのパケットを順に答えよ」 |
| `why` | なぜそうなっているか | 「なぜ 2-way ではなく 3-way なのか?」 |
| `comparison` | 対比・違い | 「UDP との違いを述べよ」 |
| `trade_off` | 利点と欠点 | 「3-way handshake のオーバーヘッドと信頼性のトレードオフ」 |
| `debugging` | 不具合特定 | 「なぜ接続が SYN_SENT で止まるか」 |
| `design` | 設計判断 | 「高速接続が必要な要件で TCP/UDP どちらを選ぶか」 |
| `edge_case` | 境界・異常系 | 「最後の ACK が届かなかった場合の挙動は?」 |
| `code_reading` | コードから推論 | tcpdump 出力を見て現在のフェーズを当てる |
| `applied_scenario` | 本番シナリオ | 「SYN flood 攻撃が発生、原因と対処は?」 |
| `historical` | 背景・歴史 | 「3-way handshake はなぜ設計されたのか?」 |
| `computation` | 計算 | ウィンドウサイズから理論スループットを計算 |

同一 concept_id に対して**複数タイプを保持**し、出題時にローテーションする。

---

## 2.4. Spaced Repetition (FSRS v5)

### 2.4.1. 採用アルゴリズム: FSRS

- **FSRS (Free Spaced Repetition Scheduler) v5** を採用
- SM-2 (旧 Anki) より予測精度が高い
- TypeScript 実装: `ts-fsrs` (npm)

### 2.4.2. 記憶状態 (concept 単位)

各 `(user, concept)` ペアに以下を保持:

```
stability    : 記憶が持つ日数 (初期 1.0)
difficulty   : 0-10 (初期 5.0、ユーザーごとに難しさが違う)
last_review  : 最終復習日時
next_review  : 次回出題日時 (計算結果)
review_count : 総復習回数
lapse_count  : 忘却回数
```

### 2.4.3. 評価スケール

採点結果を 4 段階のいずれかに変換:

| 評価 | 意味 | FSRS への影響 |
|---|---|---|
| `Again` | 完全に間違えた | stability 大幅減、次回すぐ |
| `Hard` | なんとか正解 or 部分正解 | stability 微増 |
| `Good` | 普通に正解 | stability 増加 |
| `Easy` | 簡単に正解 | stability 大幅増 |

自己評価 (ユーザーの 1-5 入力) も併用して精度を上げる。

### 2.4.4. 粒度の設計

- **Concept 単位で state を保持** (個別の問題ではなく)
- 同じ concept を違う質問タイプで出しても state を共有
- これにより「問題タイプが変わっても忘却曲線は引き継がれる」

### 2.4.5. 特殊ルール

- **間違えた直後は最短 10 分後に再出題** (短期記憶から中期へ転送)
- 部分正解 (0.5-0.9 スコア) は `Hard` として扱う
- 3 連続正解で難易度レベルを上げる (intro → applied → edge_case)

---

## 2.5. マスタリーモデル

concept ごとの習熟度を 0-100% で連続値として算出:

```
mastery = sigmoid(stability / (days_since_intro + 1)) × weighted_recent_accuracy
```

| mastery % | 意味 | 出題戦略 |
|---|---|---|
| 0-20% | 未習 or 混乱中 | 毎日出題 |
| 20-50% | 学習中 | 数日おき |
| 50-80% | 定着中 | 週1〜2 |
| 80%+ | 習得 | 忘却防止のため月1 |

mastery が 80% を超えたら、**その concept を prereq に持つ上位概念が解禁**される。

---

## 2.6. セッションの 4 タイプ

| タイプ | ルート | 説明 |
|---|---|---|
| **Daily Drill** | `/drill` | 今日の復習 (10-15 分)、`next_review <= now` の concept を FSRS 優先度順に出題 |
| **Deep Dive** | `/deep/:domain` | 1ドメインを集中的に。指定ドメイン内の concept を難易度順に連続出題 |
| **Custom Session** | `/custom` | ユーザー指定 (詳細は `04-custom-sessions.md`) |
| **Mistake Review** | `/review` | 誤答だけを再出題。直近 N 日の incorrect attempt から |

### 2.6.1. Daily Drill の選択アルゴリズム

```
candidates = concepts where mastery.next_review <= now
         OR prereqs_all_mastered AND mastery.attempt_count = 0 (blind spot)

優先度 = weight_overdue(next_review からの経過日数)
      + weight_lapse(lapse_count)
      + weight_blind_spot(1 if 未着手)
      - weight_mastery(mastery %)

上位 N 件を選択。
```

### 2.6.2. Deep Dive のアルゴリズム

- 指定ドメインの concept を `prereqs` 順にトポロジカルソート
- `difficulty_levels` を intro → applied → edge_case の順に昇順出題
- 1 セッション = 10-15 問

---

## 2.7. 誤概念 (Misconception) のトラッキング

誤答時に「なぜそう答えたか」を入力させ、LLM が誤概念を抽出・タグ付けする。

- `misconceptions` テーブルに保存
- 同じ誤概念が繰り返し出たら、**次回の問題生成プロンプトに矯正指示を注入**
- Insights 画面で「繰り返す誤解」として可視化

詳細は `05-insights.md` の Misconception Tracker を参照。

---

## 2.8. オンボーディング時の初期診断

新規ユーザーがログイン直後に **3-5 分の診断テスト** を実施:

1. 各ドメインから 2-3 問ずつ (合計 20 問程度)
2. 結果から初期 `mastery` と `difficulty` を設定
3. 以降の Daily Drill にスムーズに接続

これにより「最初から無関係な問題ばかり」を回避する。
