# 08. MVP とロードマップ

「何を最初に作り、何を後回しにするか」を明確にする。

---

## 8.1. MVP の目的

1. **ドッグフード可能な最小プロダクト** を作り、自分自身が使えるレベルに到達する
2. 数人の α ユーザー (エンジニア友人) がテストできる状態
3. 以下が成立している:
   - 毎日ログインして問題を解きたくなる体験
   - 学習が進んでいる実感が得られる
   - 1 セッション = 10-15 分で完結

---

## 8.2. MVP スコープ (6-8 週間想定、1人開発)

### 8.2.1. 機能

#### 必須

- ユーザー登録・ログイン (Clerk)
- 知識ツリー seed: **5 ドメイン × 20 concept = 100 concept**
  - os, network, security, db, languages を優先
- 問題タイプ: **mcq + short + written** の 3 つのみ
- 思考スタイル: **memorization / why / comparison / trade_off / applied_scenario** の 5 つ
- 問題生成 (Claude Sonnet 4.6)
- 採点 (Haiku / Sonnet 混在)
- 誤概念タグ付けの基本実装 (抽出は Sonnet)
- FSRS スケジューラ (`ts-fsrs`)
- **Daily Drill** モード
- **Custom Session** モード (自然言語入力のみ、パース確認 UI あり)
- Mistake Review モード (直近誤答から)
- Insights:
  - Dashboard (数値のみ、グラフなし)
  - History 画面 (時系列一覧 + 基本フィルタ: 分野・正誤)
  - 全文検索 (LIKE 句レベル)
- モバイル Web (PWA 化は後半週)
- 初回オンボーディング + 初期診断テスト
- プロンプトキャッシング

#### Out (Phase 2 以降に回す)

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
- 反論 (採点に異議) フロー
- 事前生成バッチ
- 設定画面の大半

### 8.2.2. ユーザー数想定

- α 期間: 自分 + 2-3 人
- β 公開時: 10-30 人

---

## 8.3. フェーズ別ロードマップ

### Phase 0: 基盤 (Week 1)

**目標:** Hello World レベルのスケルトンを動かす

- Next.js 15 + Turso + Drizzle + Clerk セットアップ
- shadcn/ui 導入
- ホーム画面表示 (ログイン済みユーザー情報)
- tRPC 疎通確認

### Phase 1: 問題生成と解答ループ (Week 2-3)

**目標:** 最小の「問題 → 解答 → 採点」が動く

- 知識ツリー YAML (10 concept) + seed スクリプト
- `questions` テーブル + 生成 API (Sonnet)
- `attempts` テーブル + 採点 API (Haiku/Sonnet)
- 最小の `/drill` 画面 (mcq のみ)
- 解答 → 採点 → 次の問題への連鎖

### Phase 2: FSRS + Mastery + Custom (Week 4-5)

**目標:** 学習サイクルが科学的に回る

- `mastery` テーブル + FSRS 統合 (`ts-fsrs`)
- `next_review` に基づく Daily Drill 候補選定
- 問題タイプに short / written を追加
- Custom Session の NL パース (Haiku)
- Custom Session の実行

### Phase 3: Insights と誤概念 (Week 6-7)

**目標:** 自分の学習状態が見える

- `misconceptions` テーブル + 抽出ロジック
- Insights Dashboard 画面
- History 画面 + 基本フィルタ
- 簡易検索 (LIKE 句)
- Mistake Review モード

### Phase 4: 公開準備 (Week 8)

**目標:** α → β 公開

- PWA 化 (manifest + Service Worker)
- モバイル UX の最終調整
- 初回オンボーディング + 診断テスト
- 本番デプロイ (Vercel + Turso)
- 招待 URL で α ユーザーに配布

### Phase 5: 定着と深掘り (Week 9-12)

**目標:** 継続率向上 + 機能追加

- Deep Dive モード
- Mastery Map ビジュアル (サンバースト)
- FTS5 全文検索
- 問題タイプ拡張 (cloze, code_read)
- Custom Session の Template 保存
- Trends グラフ

### Phase 6: 差別化機能 (Week 13+)

**目標:** 他にない体験で有料化の背中を押す

- コード実行サンドボックス (Judge0)
- 設計問題の対話採点
- Weekly Digest 自動生成・配信
- Web Push 通知
- Misconception Tracker UI
- 反論フロー
- 事前生成バッチ
- オフライン対応強化

### Phase 7 以降: 拡張機能

- ユーザーコードからの問題生成 (Agent)
- BYOK (Bring Your Own Key) オプション
- Template 共有 URL
- チーム機能 (会社内で学習状況共有)
- i18n (英語対応)

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

- **ドッグフードで毎日使える** ようになる機能
- **他にない差別化** になる機能 (Custom Session, Insights など)
- 収益化に直結する機能 (Pro プラン制限、決済)

### 8.5.2. 後回し

- 見栄え系 (アニメーション、凝った可視化)
- エッジケース対応 (ほとんど発生しないエラー)
- 網羅性 (問題タイプを全部揃える)
- スケール対応 (ユーザー 100 人超えてから)

### 8.5.3. やらない

- 過剰な抽象化 / 汎用化
- 他言語対応 (MVP では日本語のみ)
- デスクトップネイティブアプリ (Electron など)
- 独自 LLM ホスティング

---

## 8.6. マイルストーン

| マイルストーン | 時期 | 指標 |
|---|---|---|
| **M1: 自分で使える** | Week 4 | 自分が毎日 Tanren で勉強している |
| **M2: α 公開** | Week 8 | 友人 3 人が 1 週間使える |
| **M3: β 公開** | Week 12 | ユーザー 30 人、D7 retention 30%+ |
| **M4: 有料化** | Week 16 | Pro プラン 10 人、月次 $100 |
| **M5: 継続確認** | Week 24 | 有料会員 100 人、月次 $1,000 |

---

## 8.7. 意思決定の時点

各フェーズ終了時に以下を判断:

### Phase 1 終了時

- 問題生成の品質は許容範囲か?
- コストは見込み内か?

### Phase 3 終了時

- 自分で毎日使っているか?
- Insights が本当に役立つか?

### Phase 4 終了時

- α ユーザーの反応は?
- 何が刺さり、何が滑ったか?

### Phase 6 終了時

- 有料化可能なレベルに達したか?
- 継続率は想定通りか?

---

## 8.8. Go / No-Go 判定基準

各フェーズで「撤退すべきか続けるべきか」の目安:

- **Go**: ユーザーが「これは続けたい」と言う、数値指標が伸びている
- **No-Go**: 3 週間かけても誰も使わない、コストが収入の 3 倍を超える

No-Go と判断したら速やかに方向転換 or 撤退する。

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
