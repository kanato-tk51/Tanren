# 06. システム構成

データモデル、アーキテクチャ、API、技術選定を一括で記載。

---

## 6.1. システム全体図

```
┌─────────────────────────────────────────────┐
│ PWA (Next.js App Router)                     │
│  /, /drill, /deep, /custom, /insights/*      │
│  + Service Worker + Web Push                 │
└────────────────┬─────────────────────────────┘
                 │ tRPC
┌────────────────▼─────────────────────────────┐
│ Next.js API Layer (App Router Route Handlers)│
│  ├─ scheduler   (FSRS → 次の concept/問題)   │
│  ├─ generator   (Claude API 呼び出し)         │
│  ├─ grader      (Claude API 呼び出し)         │
│  ├─ parser      (NL → CustomSessionSpec)      │
│  ├─ insights    (集計クエリ)                  │
│  └─ notification (Web Push, cron)             │
└────────┬─────────┬───────────────────┬───────┘
         │         │                   │
    ┌────▼─┐  ┌────▼────────┐    ┌─────▼──────┐
    │Turso │  │Anthropic API│    │Upstash Redis│
    │libSQL│  │   (Claude)  │    │(rate limit) │
    └──────┘  └─────────────┘    └─────────────┘
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
CREATE TABLE concepts (
  id TEXT PRIMARY KEY,              -- 'network.tcp.congestion'
  domain_id TEXT NOT NULL,
  subdomain_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  prereqs TEXT,                     -- JSON array
  tags TEXT,                        -- JSON array
  difficulty_levels TEXT,           -- JSON array
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX idx_concepts_domain ON concepts(domain_id);

-- ユーザー
CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- Clerk user_id
  email TEXT UNIQUE,
  display_name TEXT,
  timezone TEXT DEFAULT 'Asia/Tokyo',
  daily_goal INTEGER DEFAULT 15,    -- 1日の目標問題数
  notification_time TEXT,           -- HH:mm 形式
  created_at INTEGER,
  plan TEXT DEFAULT 'free'          -- 'free' | 'pro'
);

-- 生成済み問題キャッシュ
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  concept_id TEXT NOT NULL,
  type TEXT NOT NULL,               -- 'mcq' | 'short' | 'written' | ...
  thinking_style TEXT,
  difficulty TEXT NOT NULL,         -- 'intro' | 'applied' | 'edge_case'
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  rubric TEXT,                      -- JSON
  distractors TEXT,                 -- JSON (mcq only)
  hint TEXT,
  explanation TEXT,
  tags TEXT,
  generated_by TEXT,                -- 'claude-sonnet-4-6'
  prompt_version TEXT,              -- 'v1.2.0'
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

| レイヤ | 採用技術 | 理由 |
|---|---|---|
| Framework | **Next.js 15 (App Router)** | 慣れた技術、SSR/ISR 柔軟、Route Handlers で API 統合 |
| Language | **TypeScript** | 型安全 |
| Runtime | **Bun** (or Node.js) | 速度とオールインワン |
| DB | **Turso (libSQL)** | エッジ分散、無料枠、FTS5 対応 |
| ORM | **Drizzle** | 型安全、軽い、マイグレーション直感的 |
| API | **tRPC** | 型安全 RPC、Next.js と相性良 |
| Auth | **Clerk** | 開発速度優先、Social ログイン標準装備 |
| LLM | **Anthropic Claude API** | Haiku / Sonnet / Opus を用途別に |
| UI | **shadcn/ui + Tailwind** | 短時間で整った UI |
| Code Editor | **CodeMirror 6** | 軽量、モバイル可、言語拡張豊富 |
| Charts | **Recharts** | React と相性、シンプル |
| State | **TanStack Query + Zustand** | サーバー状態 + UI 状態の分離 |
| URL 状態 | **nuqs** | フィルタなどの URL 同期 |
| i18n | 日本語のみ (当面) | スコープ絞る |
| PWA | **next-pwa** or **Serwist** | Service Worker 統合 |
| Push 通知 | **Web Push API** + `web-push` | iOS 16.4+ 対応 |
| Rate limit | **Upstash Redis** | サーバーレスで従量課金 |
| Analytics | **PostHog** | プロダクト分析、feature flag |
| Deploy | **Vercel** | Next.js と相性、Turso と統合 |
| 監視 | **Sentry** + **Logtail** (Better Stack) | エラー追跡 + ログ |

---

## 6.6. 環境と構成

### 6.6.1. 環境

- `development` — ローカル、Bun + Turso local
- `preview` — Vercel Preview ブランチ、Turso preview branch
- `production` — Vercel Prod、Turso prod

### 6.6.2. 主要な環境変数

```
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
ANTHROPIC_API_KEY=
UPSTASH_REDIS_URL=
UPSTASH_REDIS_TOKEN=
POSTHOG_KEY=
SENTRY_DSN=
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
```

### 6.6.3. cron / バックグラウンドジョブ

- **Vercel Cron** or **Turso Scheduled Tasks**
- ジョブ:
  - 日次: `daily_stats` 集計、Weekly Digest 配信準備
  - 週次: Weekly Digest 生成・配信
  - 4時間ごと: 事前生成バッチ (未充足の questions を補充)

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

- Anthropic API 呼び出しは Upstash Redis でユーザーごとに制限
- Free: 1日 10 問、Pro: 1分 10 問

---

## 6.9. 観測性

| レイヤ | ツール |
|---|---|
| エラー | Sentry |
| ログ | Logtail (Better Stack) |
| プロダクト分析 | PostHog |
| パフォーマンス | Vercel Analytics |
| LLM トレース | 独自ログ (prompt_version, 生成/採点結果を attempts に記録) |
