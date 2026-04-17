# 10. タクソノミ Seed (Tier 1, たたき台)

`02-learning-system.md` で定義した 13 ドメインのうち、**MVP で扱う Tier 1 の 6 ドメイン**について、`(domain → subdomain → concept)` の 3 階層で具体化したたたき台。

- このファイルは **`src/db/seed/concepts.yaml` の元ネタ**
- 合計: **約 100 concept** (6 ドメイン × 平均 ~17)
- 難易度レベルは 6 段階 (`beginner / junior / mid / senior / staff / principal`) のうち、各 concept が意味を持つ範囲を記載
- 着手後に使いながら追加・削除・改名していく。**Day 4 の seed スクリプトはこの一部抜粋** (最初は 10 concept) から始める

---

## 10.1. programming (17)

プログラミング言語基礎。特定言語ではなく共通概念中心。具体例は TypeScript / Python 中心。

### programming.basics

```yaml
- id: programming.basics.value_vs_reference
  name: 値渡しと参照渡し
  difficulty_levels: [beginner, junior]
  tags: [memory, semantics]

- id: programming.basics.scope_closure
  name: スコープとクロージャ
  prereqs: [programming.basics.value_vs_reference]
  difficulty_levels: [junior, mid]
  tags: [closure, lexical]

- id: programming.basics.mutability
  name: ミュータビリティとイミュータビリティ
  difficulty_levels: [junior, mid]
  tags: [immutability, functional]
```

### programming.typing

```yaml
- id: programming.typing.static_vs_dynamic
  name: 静的型付けと動的型付け
  difficulty_levels: [beginner, junior]

- id: programming.typing.generics
  name: ジェネリクス (TypeScript)
  prereqs: [programming.typing.static_vs_dynamic]
  difficulty_levels: [junior, mid]

- id: programming.typing.variance
  name: 共変・反変
  prereqs: [programming.typing.generics]
  difficulty_levels: [mid, senior]
  tags: [variance, subtyping]

- id: programming.typing.discriminated_union
  name: 判別可能な直和型
  prereqs: [programming.typing.generics]
  difficulty_levels: [junior, mid]
```

### programming.error_handling

```yaml
- id: programming.error_handling.exceptions_vs_result
  name: 例外 vs Result/Either
  difficulty_levels: [junior, mid, senior]
  tags: [error-handling]

- id: programming.error_handling.error_propagation
  name: エラーの伝播と捕捉粒度
  prereqs: [programming.error_handling.exceptions_vs_result]
  difficulty_levels: [mid, senior]
```

### programming.async

```yaml
- id: programming.async.event_loop
  name: イベントループ
  difficulty_levels: [junior, mid]
  tags: [concurrency, javascript]

- id: programming.async.promise_async_await
  name: Promise / async-await の挙動
  prereqs: [programming.async.event_loop]
  difficulty_levels: [junior, mid]

- id: programming.async.backpressure
  name: バックプレッシャ
  prereqs: [programming.async.promise_async_await]
  difficulty_levels: [mid, senior]
  tags: [streaming]

- id: programming.async.cancellation
  name: キャンセレーション (AbortController 等)
  prereqs: [programming.async.promise_async_await]
  difficulty_levels: [mid, senior]
```

### programming.functional

```yaml
- id: programming.functional.higher_order
  name: 高階関数
  difficulty_levels: [beginner, junior]

- id: programming.functional.map_filter_reduce
  name: map / filter / reduce
  prereqs: [programming.functional.higher_order]
  difficulty_levels: [beginner, junior]

- id: programming.functional.pure_and_side_effects
  name: 純粋関数と副作用
  difficulty_levels: [junior, mid]
  tags: [functional, testability]

- id: programming.functional.currying_partial
  name: カリー化と部分適用
  prereqs: [programming.functional.higher_order]
  difficulty_levels: [junior, mid]
```

---

## 10.2. dsa (17)

データ構造とアルゴリズム。面接頻出 + 実務直結を中心に。

### dsa.complexity

```yaml
- id: dsa.complexity.big_o
  name: Big O 記法
  difficulty_levels: [beginner, junior]

- id: dsa.complexity.time_vs_space
  name: 時間計算量と空間計算量のトレードオフ
  prereqs: [dsa.complexity.big_o]
  difficulty_levels: [junior, mid]

- id: dsa.complexity.amortized
  name: 償却計算量
  prereqs: [dsa.complexity.big_o]
  difficulty_levels: [mid, senior]
  tags: [analysis]
```

### dsa.structures

```yaml
- id: dsa.structures.array_vs_linkedlist
  name: 配列 vs 連結リスト
  difficulty_levels: [beginner, junior]

- id: dsa.structures.hash_map
  name: ハッシュマップ (衝突解決含む)
  difficulty_levels: [junior, mid]
  tags: [hashing]

- id: dsa.structures.binary_heap
  name: 二分ヒープ
  difficulty_levels: [junior, mid]
  tags: [priority-queue]

- id: dsa.structures.bst_balanced
  name: 二分探索木と平衡木
  prereqs: [dsa.structures.array_vs_linkedlist]
  difficulty_levels: [mid, senior]

- id: dsa.structures.trie
  name: トライ木
  difficulty_levels: [mid, senior]
  tags: [string]

- id: dsa.structures.graph_repr
  name: グラフの表現 (隣接リスト/行列)
  difficulty_levels: [junior, mid]
```

### dsa.algorithms

```yaml
- id: dsa.algorithms.binary_search
  name: 二分探索
  prereqs: [dsa.structures.array_vs_linkedlist]
  difficulty_levels: [beginner, junior, mid]

- id: dsa.algorithms.sorting
  name: ソート (quick/merge/heap) の比較
  difficulty_levels: [junior, mid]

- id: dsa.algorithms.bfs_dfs
  name: BFS / DFS
  prereqs: [dsa.structures.graph_repr]
  difficulty_levels: [junior, mid]

- id: dsa.algorithms.dp_intro
  name: 動的計画法の基本
  difficulty_levels: [junior, mid]
  tags: [optimization]

- id: dsa.algorithms.dp_advanced
  name: DP 応用 (ナップサック / LCS / 区間 DP)
  prereqs: [dsa.algorithms.dp_intro]
  difficulty_levels: [mid, senior]

- id: dsa.algorithms.dijkstra
  name: ダイクストラ法
  prereqs: [dsa.algorithms.bfs_dfs, dsa.structures.binary_heap]
  difficulty_levels: [mid, senior]

- id: dsa.algorithms.two_pointer_sliding
  name: 2 ポインタ / スライディングウィンドウ
  difficulty_levels: [junior, mid]

- id: dsa.algorithms.union_find
  name: Union-Find
  difficulty_levels: [mid, senior]
  tags: [disjoint-set]
```

---

## 10.3. network (17)

### network.basics

```yaml
- id: network.basics.osi_tcpip
  name: OSI と TCP/IP モデル
  difficulty_levels: [beginner, junior]

- id: network.basics.ip_subnet
  name: IP アドレスとサブネット
  difficulty_levels: [beginner, junior, mid]

- id: network.basics.port_socket
  name: ポートとソケット
  difficulty_levels: [beginner, junior]
```

### network.tcp

```yaml
- id: network.tcp.three_way_handshake
  name: 3-way ハンドシェイク
  prereqs: [network.basics.port_socket]
  difficulty_levels: [junior, mid]

- id: network.tcp.flow_control
  name: フロー制御 (ウィンドウ)
  prereqs: [network.tcp.three_way_handshake]
  difficulty_levels: [junior, mid, senior]

- id: network.tcp.congestion_control
  name: 輻輳制御
  prereqs: [network.tcp.flow_control]
  difficulty_levels: [mid, senior]
  tags: [throughput]

- id: network.tcp.nagle_delayed_ack
  name: Nagle と遅延 ACK
  prereqs: [network.tcp.flow_control]
  difficulty_levels: [mid, senior]
  tags: [latency]
```

### network.http

```yaml
- id: network.http.request_response
  name: HTTP リクエスト/レスポンスの基本
  difficulty_levels: [beginner, junior]

- id: network.http.methods_idempotency
  name: HTTP メソッドとベキ等性
  difficulty_levels: [junior, mid]

- id: network.http.status_codes
  name: ステータスコードの使い分け
  difficulty_levels: [beginner, junior, mid]

- id: network.http.caching
  name: HTTP キャッシュ (ETag, Cache-Control)
  prereqs: [network.http.request_response]
  difficulty_levels: [junior, mid]

- id: network.http.h2_h3
  name: HTTP/2 と HTTP/3
  prereqs: [network.http.request_response]
  difficulty_levels: [mid, senior]
  tags: [performance, multiplex]
```

### network.tls

```yaml
- id: network.tls.handshake
  name: TLS ハンドシェイク
  prereqs: [network.tcp.three_way_handshake]
  difficulty_levels: [junior, mid, senior]

- id: network.tls.tls13_improvements
  name: TLS 1.3 の改善点
  prereqs: [network.tls.handshake]
  difficulty_levels: [mid, senior]
  tags: [security, performance]
```

### network.dns

```yaml
- id: network.dns.resolution_flow
  name: DNS 名前解決の流れ
  difficulty_levels: [beginner, junior, mid]

- id: network.dns.record_types
  name: レコードタイプ (A/AAAA/CNAME/MX/TXT)
  difficulty_levels: [junior, mid]
```

### network.realtime

```yaml
- id: network.realtime.websocket_vs_sse
  name: WebSocket と SSE の比較
  difficulty_levels: [mid, senior]
  tags: [realtime]
```

---

## 10.4. db (17)

### db.rdb.basics

```yaml
- id: db.rdb.normalization
  name: 正規化 (1NF-3NF)
  difficulty_levels: [junior, mid]

- id: db.rdb.primary_foreign_key
  name: 主キー・外部キー
  difficulty_levels: [beginner, junior]

- id: db.rdb.join_types
  name: JOIN の種類
  difficulty_levels: [junior, mid]
```

### db.rdb.querying

```yaml
- id: db.rdb.select_aggregation
  name: GROUP BY と集約関数
  difficulty_levels: [beginner, junior, mid]

- id: db.rdb.subquery_cte
  name: サブクエリと CTE
  prereqs: [db.rdb.select_aggregation]
  difficulty_levels: [junior, mid]

- id: db.rdb.window_functions
  name: ウィンドウ関数
  prereqs: [db.rdb.select_aggregation]
  difficulty_levels: [mid, senior]

- id: db.rdb.null_semantics
  name: NULL の意味論と三値論理
  difficulty_levels: [junior, mid]
  tags: [pitfall]
```

### db.rdb.performance

```yaml
- id: db.rdb.btree_index
  name: B-tree インデックス
  difficulty_levels: [junior, mid, senior]

- id: db.rdb.covering_composite_index
  name: カバリング/複合インデックス
  prereqs: [db.rdb.btree_index]
  difficulty_levels: [mid, senior]

- id: db.rdb.query_plan_reading
  name: クエリプランの読み方
  prereqs: [db.rdb.btree_index]
  difficulty_levels: [mid, senior]

- id: db.rdb.n_plus_one
  name: N+1 問題
  difficulty_levels: [junior, mid]
  tags: [pitfall, orm]
```

### db.rdb.transactions

```yaml
- id: db.rdb.acid
  name: ACID 特性
  difficulty_levels: [junior, mid]

- id: db.rdb.isolation_levels
  name: 分離レベルと発生する異常
  prereqs: [db.rdb.acid]
  difficulty_levels: [mid, senior]
  tags: [concurrency]

- id: db.rdb.deadlock
  name: デッドロックの原因と回避
  prereqs: [db.rdb.isolation_levels]
  difficulty_levels: [mid, senior]
```

### db.nosql

```yaml
- id: db.nosql.kv_vs_document_vs_wide
  name: KV / Document / Wide column の比較
  difficulty_levels: [junior, mid]

- id: db.nosql.eventual_consistency
  name: 結果整合性
  difficulty_levels: [mid, senior]
  tags: [cap]
```

### db.schema

```yaml
- id: db.schema.migration_strategies
  name: スキーマ変更 (zero-downtime migration)
  prereqs: [db.rdb.acid]
  difficulty_levels: [mid, senior]
  tags: [ops]
```

---

## 10.5. tools (16)

### tools.git

```yaml
- id: tools.git.commit_object_model
  name: Git のオブジェクトモデル (blob/tree/commit)
  difficulty_levels: [junior, mid, senior]

- id: tools.git.branching_merging
  name: ブランチ戦略と merge / rebase
  difficulty_levels: [junior, mid]

- id: tools.git.rebase_cherry_pick
  name: rebase と cherry-pick
  prereqs: [tools.git.branching_merging]
  difficulty_levels: [junior, mid]

- id: tools.git.reflog_recovery
  name: reflog によるリカバリ
  prereqs: [tools.git.commit_object_model]
  difficulty_levels: [mid, senior]

- id: tools.git.hooks
  name: Git hooks
  difficulty_levels: [junior, mid]
```

### tools.shell

```yaml
- id: tools.shell.pipes_redirects
  name: パイプとリダイレクト
  difficulty_levels: [beginner, junior]

- id: tools.shell.process_and_jobs
  name: プロセスとジョブ管理
  difficulty_levels: [junior, mid]

- id: tools.shell.grep_awk_sed
  name: grep / awk / sed
  difficulty_levels: [junior, mid]

- id: tools.shell.quoting
  name: クォーティングと変数展開
  difficulty_levels: [junior, mid]
  tags: [pitfall]
```

### tools.linux

```yaml
- id: tools.linux.file_permissions
  name: ファイルパーミッション
  difficulty_levels: [beginner, junior]

- id: tools.linux.signals
  name: シグナルとプロセス終了
  difficulty_levels: [junior, mid]

- id: tools.linux.systemd_basics
  name: systemd の基本
  difficulty_levels: [junior, mid]
```

### tools.package_build

```yaml
- id: tools.package.semver
  name: セマンティックバージョニング
  difficulty_levels: [junior, mid]

- id: tools.package.lockfile_determinism
  name: ロックファイルと再現性
  difficulty_levels: [junior, mid]

- id: tools.build.bundling_tree_shaking
  name: バンドルと tree-shaking
  difficulty_levels: [junior, mid]
  tags: [frontend]
```

### tools.debug

```yaml
- id: tools.debug.stack_trace_reading
  name: スタックトレースの読み方
  difficulty_levels: [beginner, junior, mid]
```

---

## 10.6. frontend (16)

### frontend.browser

```yaml
- id: frontend.browser.rendering_pipeline
  name: レンダリングパイプライン (HTML→Layout→Paint→Composite)
  difficulty_levels: [junior, mid]

- id: frontend.browser.event_loop_tasks
  name: ブラウザのイベントループとタスク/マイクロタスク
  difficulty_levels: [mid, senior]
  tags: [async]

- id: frontend.browser.storage_apis
  name: localStorage / sessionStorage / IndexedDB
  difficulty_levels: [junior, mid]
```

### frontend.html_css

```yaml
- id: frontend.css.box_model
  name: ボックスモデル
  difficulty_levels: [beginner, junior]

- id: frontend.css.flex_grid
  name: Flexbox と Grid
  difficulty_levels: [junior, mid]

- id: frontend.css.specificity
  name: セレクタ詳細度とカスケード
  difficulty_levels: [junior, mid]
  tags: [pitfall]

- id: frontend.html.semantic
  name: セマンティック HTML とアクセシビリティ
  difficulty_levels: [junior, mid]
  tags: [a11y]
```

### frontend.react

```yaml
- id: frontend.react.rendering_model
  name: React のレンダリングモデル
  difficulty_levels: [junior, mid]

- id: frontend.react.hooks_rules
  name: フックのルールと依存配列
  difficulty_levels: [junior, mid]
  tags: [pitfall]

- id: frontend.react.state_vs_props
  name: state と props の使い分け
  difficulty_levels: [beginner, junior]

- id: frontend.react.memoization
  name: memo / useMemo / useCallback の実務
  prereqs: [frontend.react.rendering_model]
  difficulty_levels: [mid, senior]

- id: frontend.react.server_components
  name: React Server Components と RSC 境界
  prereqs: [frontend.react.rendering_model]
  difficulty_levels: [mid, senior]
  tags: [next-js]
```

### frontend.perf

```yaml
- id: frontend.perf.core_web_vitals
  name: Core Web Vitals (LCP/INP/CLS)
  difficulty_levels: [junior, mid]

- id: frontend.perf.lazy_loading
  name: Lazy loading と code splitting
  difficulty_levels: [junior, mid]
```

### frontend.pwa

```yaml
- id: frontend.pwa.service_worker_basics
  name: Service Worker の基本ライフサイクル
  difficulty_levels: [mid, senior]

- id: frontend.pwa.caching_strategies
  name: キャッシュ戦略 (Cache First / Network First / SWR)
  prereqs: [frontend.pwa.service_worker_basics]
  difficulty_levels: [mid, senior]
```

---

## 10.7. 次のアクション

1. この seed を `src/db/seed/concepts.yaml` としてコミット (Phase 0 着手時)
2. `Day 4` の最初の 10 concept は **自分が一番鍛えたい領域** (例: frontend.react + network.http) から選ぶ
3. 使いながら違和感のある concept をリネーム/統合/分割
4. Tier 2 (os, security, design, devops, ai_ml) と Tier 3 (distributed, low_level) は別ファイル (`10a`, `10b`...) に分けて後から整備

---

## 10.8. 命名ルール (再掲)

- ID は `<domain>.<subdomain>.<concept>` で全小文字・snake_case
- subdomain は自由文字列、必要に応じて増やす
- 日本語 `name` は 20 文字以内を目安
- prereqs は同 domain 内を基本、他 domain 参照は必要なときだけ
- tags は横串検索用、命名は kebab-case
