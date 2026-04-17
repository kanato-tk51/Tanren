# 08. MVP とロードマップ

「何を最初に作り、何を後回しにするか」を明確にする。個人開発前提。

---

## 8.1. MVP の目的

1. **自分が毎日使える最小プロダクト** を作る
2. 以下が成立している:
   - 自分が毎日ログインして問題を解きたくなる体験
   - 学習が進んでいる実感が得られる
   - 1 セッション = 10-15 分で完結

---

## 8.2. MVP スコープ

### 8.2.1. 必須機能

- ユーザー登録・ログイン (Clerk) — 自分のアカウントだけ使う想定
- 知識ツリー seed: **Tier 1 の 6 ドメイン × 17 concept ≒ 100 concept**
  - programming, dsa, network, db, tools, frontend を優先 (日常の Web 開発で毎日触る領域)
- 問題タイプ: **mcq + short + written** の 3 つのみ
- 思考スタイル: **memorization / why / comparison / trade_off / applied_scenario** の 5 つ
- 問題生成 (Claude Sonnet 4.6)
- 採点 (Haiku / Sonnet 混在)
- 誤概念タグ付けの基本実装 (抽出は Sonnet)
- **採点への反論ボタン** (再採点) — R1 対策として初日から必要
- **「詳しく聞く用にコピー」ボタン** — 問題 + 回答 + 採点を LLM 用プロンプトに整形してクリップボードにコピー (`07.13`)
- FSRS スケジューラ (`ts-fsrs`)
- **Daily Drill** モード
- **Custom Session** モード (自然言語入力 + 読み取り専用のパース結果表示)
- Mistake Review モード (直近誤答から)
- Insights:
  - Dashboard (数値のみ、グラフなし)
  - History 画面 (時系列一覧 + 基本フィルタ: 分野・正誤)
  - 全文検索 (LIKE 句レベル)
- モバイル Web (PWA 化は後半週)
- 初回オンボーディング + 初期診断テスト
- プロンプトキャッシング

### 8.2.2. Out (Phase 2 以降に回す)

- Deep Dive モード
- 問題タイプ: cloze / code_read / code_debug / design
- 思考スタイル残り (debugging / edge_case / code_reading / historical / computation)
- コード実行サンドボックス (Judge0)
- 設計問題の対話採点
- Custom Session の Template 保存
- Mastery Map のビジュアル (サンバースト)
- Misconception Tracker の UI (データ蓄積のみ)
- Trends グラフ
- Weekly Digest
- Web Push 通知
- FTS5 全文検索
- オフライン対応
- 事前生成バッチ
- 設定画面の大半

---

## 8.3. フェーズ別ロードマップ

※ 期間は目安。個人開発なので厳守ではない。

### Phase 0: 基盤

**目標:** Hello World レベルのスケルトンを動かす

- Next.js 15 + Turso + Drizzle + Clerk セットアップ
- shadcn/ui 導入
- ホーム画面表示 (ログイン済みユーザー情報)
- tRPC 疎通確認

### Phase 1: 問題生成と解答ループ

**目標:** 最小の「問題 → 解答 → 採点」が動く

- 知識ツリー YAML (10 concept) + seed スクリプト
- `questions` テーブル + 生成 API (Sonnet)
- `attempts` テーブル + 採点 API (Haiku/Sonnet)
- 最小の `/drill` 画面 (mcq のみ)
- 解答 → 採点 → 次の問題への連鎖

### Phase 2: FSRS + Mastery + Custom

**目標:** 学習サイクルが科学的に回る

- `mastery` テーブル + FSRS 統合 (`ts-fsrs`)
- `next_review` に基づく Daily Drill 候補選定
- 問題タイプに short / written を追加
- Custom Session の NL パース (Haiku)
- Custom Session の実行

### Phase 3: Insights と誤概念

**目標:** 自分の学習状態が見える

- `misconceptions` テーブル + 抽出ロジック
- Insights Dashboard 画面
- History 画面 + 基本フィルタ
- 簡易検索 (LIKE 句)
- Mistake Review モード

### Phase 4: 日常使いに耐える

**目標:** 自分が毎日使える状態にする

- PWA 化 (manifest + Service Worker)
- モバイル UX の最終調整
- 初回オンボーディング + 診断テスト
- 本番デプロイ (Vercel + Turso)

### Phase 5: 深掘り機能

**目標:** 継続して使うための満足度を上げる

- Deep Dive モード
- Mastery Map ビジュアル (サンバースト)
- FTS5 全文検索
- 問題タイプ拡張 (cloze, code_read)
- Custom Session の Template 保存
- Trends グラフ

### Phase 6: 差別化・深化機能

**目標:** 自分の学習効果を最大化する

- コード実行サンドボックス (Judge0)
- 設計問題の対話採点
- Weekly Digest 自動生成・自分宛て配信
- Web Push 通知
- Misconception Tracker UI
- 反論フロー
- 事前生成バッチ
- オフライン対応強化

### Phase 7 以降: 発展的機能 (余力あれば)

- ユーザーコードからの問題生成 (Agent) — 自分の GitHub リポジトリから問題化
- BYOK (Bring Your Own Key) — 使わない
- Template 共有 URL — 使わない
- i18n (英語対応) — 気分次第

---

## 8.4. Week 0 — 最初の 1 週間で作るもの

実装着手初日〜7日目で作るものを具体化。

### Day 1: セットアップ

- Next.js 15 プロジェクト作成
- TypeScript / Tailwind / shadcn/ui 導入
- Vercel にデプロイ (空のページで OK)

### Day 2: 認証

- Clerk 統合
- ログイン / ログアウトが動く
- ユーザー情報取得確認

### Day 3: DB

- Turso アカウント作成、DB 作成
- Drizzle 導入 + 初期スキーマ (users, concepts, questions, attempts, mastery, sessions)
- マイグレーション実行

### Day 4: 知識ツリー Seed

- YAML で 10 concept 定義
- Seed スクリプトで DB 投入
- `concepts.list` tRPC で取得確認

### Day 5: 問題生成

- Anthropic SDK 導入
- 最小の生成関数 (concept を受け取り JSON 返す)
- `questions.generate` tRPC で確認
- 生成結果を DB にキャッシュ

### Day 6: 出題画面

- `/drill` ページ
- 問題表示 (mcq のみ)
- 解答送信 → 採点 → 次の問題へ

### Day 7: FSRS 最小統合

- `ts-fsrs` 導入
- 採点結果から `(Again|Hard|Good|Easy)` を決定
- `mastery.next_review` 更新
- 翌日以降の Daily Drill に反映されるか確認

**Week 0 終了時の状態:**
「自分が生成した 10 concept の問題を解いて、記憶定着の仕組みが動く」MVP の中核が動く。ここで **この設計で行ける**判定。

---

## 8.5. 優先度判定の原則

機能追加を判断するときの指針:

### 8.5.1. まず入れる

- **自分が毎日使う** ために必要な機能
- **学習効果を押し上げる** 機能 (Custom Session, Insights, 誤概念矯正など)
- 作っていて楽しい機能

### 8.5.2. 後回し

- 見栄え系 (アニメーション、凝った可視化)
- エッジケース対応 (ほとんど発生しないエラー)
- 網羅性 (問題タイプを全部揃える)
- 他の人のための機能 (使わないので)

### 8.5.3. やらない

- 過剰な抽象化 / 汎用化
- 他言語対応 (日本語のみ)
- デスクトップネイティブアプリ (Electron など)
- 独自 LLM ホスティング
- 他ユーザー向けの配慮 (共有機能、チーム機能、マルチテナント対応など)

---

## 8.6. マイルストーン

| マイルストーン | 状態 |
|---|---|
| **M1: スケルトン動作** | Next.js + DB + 認証が繋がる |
| **M2: 問題 1 問解ける** | 生成 → 解答 → 採点のループが動く |
| **M3: 毎日使いたい** | FSRS + Daily Drill が完成、自分が継続して開く |
| **M4: 学習が見える** | Insights で自分の成長が分かる |
| **M5: スマホで完結** | PWA 化、通勤中に使える |
| **M6: 習慣化** | 30 日以上継続して使っている |

期限は設けない。自分のペースで進める。

---

## 8.7. 各フェーズでの振り返り観点

モチベーションや方向性が合っているかを定期的に確認する。

### Phase 1 終了時

- 問題生成の品質は許容範囲か?
- 作っていて楽しいか?

### Phase 3 終了時

- 自分で毎日使っているか?
- Insights が本当に役立つか?

### Phase 4 終了時

- 何が刺さり、何が滑ったか?
- 次に何を作りたいか?

### Phase 6 終了時

- 最初に描いたビジョンは達成できているか?
- 新しくやりたいことは出てきたか?

---

## 8.8. 「やめる」判断基準

個人開発なので「撤退」ではなく「一旦休む / 方向転換する」判断として:

- 2-3 週間ログインしていない状態が続く
- 作っていて楽しくない、義務感しかない
- 代替サービスで目的が達成できている

こうなったら無理に続けず、学んだことを持って次のプロジェクトへ。

---

## 8.9. MVP で**やらない**ことリスト (再掲、重要)

明確に切り捨てる:

- ❌ モバイルネイティブアプリ (Web PWA で十分)
- ❌ 他 LLM プロバイダ対応 (Claude 一本)
- ❌ 英語対応 (日本語のみ)
- ❌ ソーシャル機能 (ランキング、友達機能など)
- ❌ ゲーミフィケーション (バッジ、ポイントなど派手なもの)
- ❌ 書き物の学習コンテンツ提供 (問題を解くことに特化)
- ❌ 教材の自動生成 (コース構成など)
- ❌ ビデオ / 音声コンテンツ
- ❌ 自動採点の完全な正確性保証 (反論フローで吸収)
- ❌ マルチユーザー対応 (自分用なので 1 ユーザーで十分)
