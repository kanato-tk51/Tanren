# 06. システム構成

データモデル、アーキテクチャ、API、技術選定を一括で記載。

---

## 6.1. システム全体図

```
┌─────────────────────────────────────────────┐
│ PWA (Next.js App Router)                     │
│  /, /drill, /deep, /custom, /insights/*      │
│  + Service Worker (App Shell cache のみ)     │
└────────────────┬─────────────────────────────┘
                 │ tRPC
┌────────────────▼─────────────────────────────┐
│ Next.js API Layer (App Router Route Handlers)│
│  ├─ scheduler   (FSRS → 次の concept/問題)   │
│  ├─ generator   (Claude API 呼び出し)         │
│  ├─ grader      (Claude API 呼び出し)         │
│  ├─ parser      (NL → CustomSessionSpec)      │
│  └─ insights    (集計クエリ)                  │
└────────┬─────────┬───────────────────────────┘
         │         │
    ┌────▼─┐  ┌────▼────────┐
    │Turso │  │Anthropic API│
    │libSQL│  │   (Claude)  │
    └──────┘  └─────────────┘

Phase 3+ で追加:
  - Resend (メール配信)
Phase 5+ で追加:
  - Web Push (通知)
  - Upstash Redis (複数ユーザーに開くとき)
```

---

## 6.2. データモデル (Drizzle + Turso)

### 6.2.1. テーブル一覧と役割

| テーブル | 役割 |
|---|---|
| `users` | ユーザー情報、設定 |
| `concepts` | 知識ツリーのマスタ |
| `questions` | 生成済み問題のキャッシュ |
| `sessions` | セッション (Daily/Deep/Custom/Review) |
| `attempts` | 1 問ごとの解答履歴 |
| `mastery` | FSRS 状態 (user × concept) |
| `misconceptions` | 誤概念トラッカー |
| `session_templates` | Custom Session のテンプレ |
| `daily_stats` | 日次集計キャッシュ |
| `attempts_fts` | 全文検索仮想テーブル |

### 6.2.2. スキーマ定義

```sql
-- 知識ツリー
-- domain は TypeScript 側の const enum (13 ドメイン) でハードコード管理。
-- domains テーブルは作らない (マスタが YAML なので二重管理を避ける)。
CREATE TABLE concepts (
  id TEXT PRIMARY KEY,              -- 'network.tcp.congestion'
  domain_id TEXT NOT NULL,          -- enum: 13 ドメインのいずれか
  subdomain_id TEXT,                -- 文字列、free-form (YAML 側で定義)
  name TEXT NOT NULL,
  description TEXT,
  prereqs TEXT,                     -- JSON array
  tags TEXT,                        -- JSON array
  difficulty_levels TEXT,           -- JSON array (6段階のサブセット)
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX idx_concepts_domain ON concepts(domain_id);

-- ユーザー (個人用途のため事実上 1 行のみ)
CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- Clerk user_id
  email TEXT UNIQUE,
  display_name TEXT,
  timezone TEXT DEFAULT 'Asia/Tokyo',
  daily_goal INTEGER DEFAULT 15,    -- 1日の目標問題数
  notification_time TEXT,           -- HH:mm 形式
  created_at INTEGER
);

-- 生成済み問題キャッシュ
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  concept_id TEXT NOT NULL,
  type TEXT NOT NULL,               -- 'mcq' | 'short' | 'written' | ...
  thinking_style TEXT,
  difficulty TEXT NOT NULL,         -- 'beginner'|'junior'|'mid'|'senior'|'staff'|'principal'
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  rubric TEXT,                      -- JSON
  distractors TEXT,                 -- JSON (mcq only)
  hint TEXT,
  explanation TEXT,
  tags TEXT,
  generated_by TEXT,                -- 'claude-sonnet-4-6'
  prompt_version TEXT,              -- 'v1.2.0'
  retired INTEGER DEFAULT 0,        -- 1 なら再出題しない (事実誤認など)
  retired_reason TEXT,
  created_at INTEGER,
  last_served_at INTEGER,
  serve_count INTEGER DEFAULT 0,
  FOREIGN KEY (concept_id) REFERENCES concepts(id)
);

CREATE INDEX idx_questions_concept_type_style
  ON questions(concept_id, type, thinking_style, difficulty);

-- セッション
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,               -- 'daily' | 'deep' | 'custom' | 'review'
  spec TEXT,                        -- CustomSessionSpec JSON (custom のみ)
  template_id TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  question_count INTEGER,
  correct_count INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (template_id) REFERENCES session_templates(id)
);

CREATE INDEX idx_sessions_user_started ON sessions(user_id, started_at DESC);

-- 解答履歴
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  user_answer TEXT,
  correct INTEGER,                  -- 0/1
  score REAL,                       -- 0.0-1.0
  self_rating INTEGER,              -- 1-5
  elapsed_ms INTEGER,
  feedback TEXT,                    -- LLM 生成の改善フィードバック
  rubric_checks TEXT,               -- JSON
  misconception_tags TEXT,          -- JSON
  reason_given TEXT,                -- 誤答時の「なぜ」
  copied_for_external INTEGER DEFAULT 0,  -- 「詳しく聞く用にコピー」の押下回数
  created_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (question_id) REFERENCES questions(id),
  FOREIGN KEY (concept_id) REFERENCES concepts(id)
);

CREATE INDEX idx_attempts_user_concept ON attempts(user_id, concept_id);
CREATE INDEX idx_attempts_user_created ON attempts(user_id, created_at DESC);

-- FSRS 状態 (concept 単位)
CREATE TABLE mastery (
  user_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  stability REAL,
  difficulty REAL,
  last_review INTEGER,
  next_review INTEGER,
  review_count INTEGER DEFAULT 0,
  lapse_count INTEGER DEFAULT 0,
  mastered INTEGER DEFAULT 0,       -- 0/1
  mastery_pct REAL DEFAULT 0,       -- 0.0-1.0
  PRIMARY KEY (user_id, concept_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (concept_id) REFERENCES concepts(id)
);

CREATE INDEX idx_mastery_next_review ON mastery(user_id, next_review);

-- 誤概念トラッカー
CREATE TABLE misconceptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  description TEXT,                 -- LLM 生成の誤概念説明
  first_seen INTEGER,
  last_seen INTEGER,
  count INTEGER DEFAULT 1,
  resolved INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (concept_id) REFERENCES concepts(id)
);

-- Custom Session テンプレ
CREATE TABLE session_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT,
  raw_request TEXT,
  spec TEXT NOT NULL,
  use_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 日次集計キャッシュ
CREATE TABLE daily_stats (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,               -- '2026-04-17'
  attempts_count INTEGER,
  correct_count INTEGER,
  concepts_touched INTEGER,
  study_time_sec INTEGER,
  domains_touched TEXT,             -- JSON array
  PRIMARY KEY (user_id, date)
);

-- 全文検索 (FTS5 仮想テーブル)
CREATE VIRTUAL TABLE attempts_fts USING fts5(
  prompt,
  user_answer,
  explanation,
  misconception_tags,
  content='attempts_view',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- attempts_view: attempts と questions を JOIN したビュー
CREATE VIEW attempts_view AS
  SELECT
    a.rowid,
    q.prompt,
    a.user_answer,
    q.explanation,
    a.misconception_tags
  FROM attempts a
  JOIN questions q ON a.question_id = q.id;
```

### 6.2.3. インデックス設計の指針

- 頻出クエリ: 「ユーザー × concept」「ユーザー × 時系列」
- FSRS スケジューラは `next_review <= now` のスキャンが必須 → インデックス必須
- FTS5 は日本語向けに `unicode61` + bigram が実用的

---

## 6.3. tRPC API 設計

### 6.3.1. ルータ構成

```typescript
export const appRouter = router({
  auth: authRouter,
  concepts: conceptsRouter,
  session: sessionRouter,
  custom: customRouter,
  insights: insightsRouter,
  settings: settingsRouter,
});
```

### 6.3.2. 主要エンドポイント

```typescript
// 概念一覧
concepts.list({ domain?: string })           → Concept[]
concepts.detail({ id })                       → Concept & Mastery

// セッション
session.start({ kind: SessionKind, spec?: CustomSessionSpec })
  → { sessionId, firstQuestion }

session.next({ sessionId })
  → { question } | { done: true, summary }

session.submit({ attemptId, answer, selfRating?, reasonGiven? })
  → { correct, score, feedback, rubricChecks, nextQuestion?, masteryDelta }

session.finish({ sessionId })
  → { summary: SessionSummary }

// Custom Session
custom.parse({ raw: string })
  → { spec: CustomSessionSpec, confidence: number }

custom.preview({ spec })
  → { sampleQuestion: Question }

custom.templates.list()                       → Template[]
custom.templates.save({ name, spec, raw })    → { id }
custom.templates.delete({ id })               → void

// Insights
insights.overview()
  → { masteryPct, weakest, blindSpots, decaying, strongest }

insights.mastery({ domain?: string })
  → { conceptsWithMastery: ConceptMastery[] }

insights.history({ filters, cursor })
  → { attempts, nextCursor }

insights.search({ q: string, filters })
  → { hits, aggregations }

insights.domainDetail({ id })
  → { stats, subdomains, thinkingStyleProfile, recentAttempts }

insights.misconceptions()
  → { misconceptions: Misconception[] }

insights.trends({ range: DateRange })
  → { masteryGrowth, accuracyByDifficulty, studyTime, domainCoverage }

// 設定
settings.get()
  → { daily_goal, notification_time, timezone, ... }

settings.update({ ... })
  → void
```

---

## 6.4. スケジューラの実装方針

### 6.4.1. Daily Drill 候補選定

```typescript
function selectDailyCandidates(userId: string, count: number): Concept[] {
  // 1. next_review <= now の concept
  const due = query(`
    SELECT c.*, m.stability, m.lapse_count
    FROM mastery m
    JOIN concepts c ON m.concept_id = c.id
    WHERE m.user_id = ? AND m.next_review <= ?
    ORDER BY m.next_review ASC
  `, [userId, Date.now()]);

  // 2. Blind spots (prereq 全て習得済 & 未着手)
  const blindSpots = query(`
    SELECT c.*
    FROM concepts c
    LEFT JOIN mastery m ON m.concept_id = c.id AND m.user_id = ?
    WHERE m.review_count IS NULL
      AND prereqs_satisfied(c, ?)
    LIMIT 2
  `, [userId, userId]);

  // 3. 優先度付けして上位 N 件返す
  return prioritize([...due, ...blindSpots], count);
}
```

### 6.4.2. 優先度計算

```typescript
function priority(concept: Concept, mastery: Mastery): number {
  const overdueFactor = daysSince(mastery.next_review);
  const lapsePenalty = mastery.lapse_count * 2;
  const blindSpotBonus = mastery.review_count === 0 ? 5 : 0;
  const masteryPenalty = mastery.mastery_pct * -3;
  return overdueFactor + lapsePenalty + blindSpotBonus + masteryPenalty;
}
```

---

## 6.5. 技術スタック (決定)

個人用途なので **MVP は最小構成**。必要になったら足す方針。

### 6.5.1. MVP 採用

| レイヤ | 採用技術 | 理由 |
|---|---|---|
| Framework | **Next.js 15 (App Router)** | 慣れた技術、SSR/ISR 柔軟、Route Handlers で API 統合 |
| Language | **TypeScript** | 型安全 |
| Runtime | **Node.js 22 LTS** | Vercel デフォルト、安定運用。Bun は魅力だが Vercel Edge 以外で相性問題あり |
| DB | **Turso (libSQL)** | エッジ分散、無料枠、FTS5 対応 |
| ORM | **Drizzle** | 型安全、軽い、マイグレーション直感的 |
| API | **tRPC** | 型安全 RPC、Next.js と相性良 |
| Auth | **Clerk** | 1 ユーザーでも OAuth の手間を省ける。将来公開時も流用可 |
| LLM | **Anthropic Claude API** | MVP は Haiku / Sonnet のみ。Opus は Phase 2+ |
| UI | **shadcn/ui + Tailwind** | 短時間で整った UI |
| Code Editor | **CodeMirror 6** | 軽量、モバイル可、言語拡張豊富 |
| Charts (Phase 2+) | **Recharts** | React と相性、シンプル。MVP はテキスト表のみ |
| State | **TanStack Query + Zustand** | サーバー状態 + UI 状態の分離 |
| URL 状態 | **nuqs** | フィルタなどの URL 同期 |
| i18n | 日本語のみ | スコープ絞る |
| PWA | **Serwist** (or next-pwa) | Service Worker 統合 |
| Deploy | **Vercel Hobby** | Next.js と相性、Turso と統合 |
| 監視 | **Sentry (Free tier)** | 個人用なのでエラー追跡のみ |
| テスト | **Vitest** | unit/integration、軽量で速い |
| メール | **Resend** (Phase 3+) | Weekly Digest / reminder 配信。無料枠で十分 |

### 6.5.2. 意図的に MVP で入れないもの

| 技術 | 入れない理由 | 再検討タイミング |
|---|---|---|
| Upstash Redis | 1 ユーザーで rate limit 不要。保険用途ならプロセス内メモリで十分 | 公開時 or 並列ユーザー発生時 |
| PostHog | 自分の行動分析は Insights 画面で代用できる | 公開時 |
| Logtail (Better Stack) | Sentry + Vercel ログで十分 | ログ量が Sentry で収まらなくなったら |
| Web Push | iOS PWA の制約が大きい。`7.5.5` 参照 | Phase 5+、実運用可否を検証後 |
| Opus 4.7 | 5 倍コスト。Sonnet の品質で不足を感じてから | Phase 2+ |
| Judge0 (コード実行) | MVP の問題タイプに不要 | Phase 6 |

### 6.5.3. メモ

- **並列ユーザーが増えたら** Upstash + PostHog を足す前提で設計しておく (アーキ変更が要らない形で)
- Clerk の無料枠は 10,000 MAU まで。1 人なら当然収まる

---

## 6.6. 環境と構成

### 6.6.1. 環境

- `development` — ローカル、Bun + Turso local
- `preview` — Vercel Preview ブランチ、Turso preview branch
- `production` — Vercel Prod、Turso prod

### 6.6.2. 主要な環境変数

```
# MVP で必要
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
ANTHROPIC_API_KEY=
SENTRY_DSN=

# Phase 3+ で追加
RESEND_API_KEY=              # メール配信

# Phase 5+ で追加
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
UPSTASH_REDIS_URL=           # 並列ユーザー発生時
UPSTASH_REDIS_TOKEN=
POSTHOG_KEY=                 # 公開時
```

### 6.6.3. cron / バックグラウンドジョブ

- **Vercel Cron** を使用
- **MVP で入れるジョブ**:
  - 日次: `daily_stats` 集計
- **Phase 5+ で追加**:
  - 週次: Weekly Digest 生成・メール配信
  - 4時間ごと: 事前生成バッチ (未充足の questions を補充)

> **Vercel Hobby の Cron 制約**
> 2 ジョブまで、かつ日次発火のみ。MVP は範囲内に収まるが、Phase 5+ で Weekly
> Digest / 4h バッチまで入れると Pro プラン ($20/月) が必要になる。その時点で
> 採算を再計算する。

---

## 6.7. プロジェクト構造

```
Tanren/
├── docs/                          # 設計ドキュメント (このフォルダ)
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── (auth)/                # ログイン前
│   │   ├── (app)/                 # ログイン後
│   │   │   ├── page.tsx           # /
│   │   │   ├── drill/
│   │   │   ├── deep/
│   │   │   ├── custom/
│   │   │   └── insights/
│   │   └── api/
│   │       └── trpc/[trpc]/
│   ├── server/
│   │   ├── trpc/                  # tRPC ルータ
│   │   ├── scheduler/             # FSRS ロジック
│   │   ├── generator/             # 問題生成
│   │   ├── grader/                # 採点
│   │   ├── parser/                # NL パース
│   │   └── insights/              # 集計クエリ
│   ├── db/
│   │   ├── schema/                # Drizzle スキーマ
│   │   ├── seed/                  # 知識ツリー YAML
│   │   └── client.ts
│   ├── features/                  # フィーチャーモジュール
│   │   ├── drill/
│   │   ├── custom-session/
│   │   ├── insights/
│   │   └── ...
│   ├── components/ui/             # shadcn/ui
│   ├── lib/                       # 共通ユーティリティ
│   │   ├── anthropic.ts
│   │   ├── fsrs.ts
│   │   └── ...
│   └── messages/                  # i18n
├── prompts/                       # LLM プロンプトテンプレ
│   ├── generation/
│   ├── grading/
│   └── parsing/
├── public/                        # 静的ファイル
├── service-worker/                # PWA Service Worker
├── drizzle/                       # マイグレーション
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── drizzle.config.ts
└── README.md
```

---

## 6.8. セキュリティ

### 6.8.1. 認証

- Clerk による OAuth (Google/GitHub)
- セッション管理は Clerk がハンドリング

### 6.8.2. 認可

- すべての DB クエリは `user_id` フィルタ必須
- Row Level Security は Turso では libSQL の view パターンで実現
- tRPC の `protectedProcedure` で middleware 制御

### 6.8.3. データ保護

- API キー類はサーバー側のみ
- PostHog には PII を送らない
- ユーザーの解答データは暗号化 (Turso の at-rest 暗号化)

### 6.8.4. レート制限

- 個人用途のためユーザー単位の厳密な制限は不要
- **暴走防止の保険** として、サーバーのプロセスメモリ上で 1 分 30 リクエストの簡易スロットリングのみ導入
- Anthropic 側の月間予算アラートが主防衛線 (例: $20 超過で通知)

---

## 6.8a. テスト戦略

個人開発なので網羅性より **「壊れたらすぐ気付く」** を優先。

### 6.8a.1. 必ず書く (MVP)

| 対象 | テスト種別 | ツール |
|---|---|---|
| FSRS スケジューラ (`ts-fsrs` ラッパ) | unit | Vitest |
| Daily Drill 優先度計算 | unit | Vitest |
| マスタリー計算式 | unit | Vitest |
| NL → CustomSessionSpec パーサ (出力JSON の妥当性検証) | unit + contract | Vitest + Zod |
| 採点プロンプトの回帰 | snapshot | Vitest + LLM 実呼出 (手動 opt-in) |
| tRPC ルータの型整合 | tsc | TypeScript strict |

### 6.8a.2. 書かない (MVP)

- UI の E2E (Playwright) — 自分が手で触るので十分
- API 全部の統合テスト — 自分が触れば壊れたら分かる
- 採点の全組合せ網羅 — コスト対効果が合わない

### 6.8a.3. プロンプト回帰テスト

プロンプト変更時の退行を防ぐための軽量テスト:

- `prompts/` に「代表入力」「代表期待出力」のペアを保存
- CI ではなく手動コマンドで走らせる (LLM コストがかかるので)
- 差分は snapshot で人間レビュー → 改悪なら revert

---

## 6.9. 観測性

### 6.9.1. MVP

| レイヤ | ツール |
|---|---|
| エラー | Sentry (Free tier) |
| ログ | Vercel Logs (直近 1h)、必要なときだけ tail |
| LLM トレース | 独自ログ (prompt_version, 生成/採点結果を `attempts` / `questions` に記録) |

### 6.9.2. Phase 5+ で追加検討

| レイヤ | ツール |
|---|---|
| プロダクト分析 | PostHog (公開時のみ) |
| パフォーマンス | Vercel Analytics |
| 長期ログ保存 | Logtail (ログ量が増えてから) |
