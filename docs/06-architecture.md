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
                 │ tRPC (cookie session)
┌────────────────▼─────────────────────────────┐
│ Next.js API Layer (App Router Route Handlers)│
│  ├─ auth        (Passkey 登録/認証、セッション) │
│  ├─ scheduler   (FSRS → 次の concept/問題)   │
│  ├─ generator   (OpenAI API 呼び出し)         │
│  ├─ grader      (OpenAI API 呼び出し)         │
│  ├─ parser      (NL → CustomSessionSpec)      │
│  └─ insights    (集計クエリ)                  │
└────────┬─────────┬───────────────────────────┘
         │         │
    ┌────▼─┐  ┌────▼────────┐
    │ Neon │  │  OpenAI API │
    │ (pg) │  │  (GPT-5)    │
    └──────┘  └─────────────┘

Phase 3+ で追加:
  - Resend (メール配信)
Phase 5+ で追加:
  - Web Push (通知)
  - Upstash Redis (複数ユーザーに開くとき)
```

---

## 6.2. データモデル (Drizzle + Neon PostgreSQL)

### 6.2.1. テーブル一覧と役割

| テーブル              | 役割                                      |
| --------------------- | ----------------------------------------- |
| `users`               | ユーザー情報、設定                        |
| `credentials`         | Passkey クレデンシャル (ADR-0004)         |
| `sessions_auth`       | 認証セッション (cookie)                   |
| `webauthn_challenges` | Passkey 登録/認証時の一時チャレンジ       |
| `concepts`            | 知識ツリーのマスタ                        |
| `questions`           | 生成済み問題のキャッシュ                  |
| `sessions`            | 学習セッション (Daily/Deep/Custom/Review) |
| `attempts`            | 1 問ごとの解答履歴                        |
| `mastery`             | FSRS 状態 (user × concept)                |
| `misconceptions`      | 誤概念トラッカー                          |
| `session_templates`   | Custom Session のテンプレ                 |
| `daily_stats`         | 日次集計キャッシュ                        |
| `attempts_search`     | 全文検索用 tsvector カラム付き view       |

### 6.2.2. スキーマ定義 (PostgreSQL 16+)

```sql
-- 知識ツリー
-- domain の真実の源は docs/02-learning-system.md §2.1.1。TypeScript 側は
-- src/db/schema/_constants.ts の DOMAIN_IDS として const enum 化する。
-- concept は:
--   * 設計の真実の源 (意図・名前・難易度の根拠): docs/10-taxonomy-seed.md
--   * 実行時のマスタ (DB への投入ソース): src/db/seed/concepts.yaml
-- domains テーブルは作らない (二重管理を避ける)。
CREATE TABLE concepts (
  id TEXT PRIMARY KEY,              -- 'network.tcp.congestion'
  domain_id TEXT NOT NULL,
  subdomain_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  prereqs JSONB DEFAULT '[]'::jsonb,
  tags JSONB DEFAULT '[]'::jsonb,
  difficulty_levels JSONB NOT NULL,  -- 6段階のサブセット。NOT NULL + 下の CHECK で 1 件以上を強制 (DEFAULT は置かず、省略は insert エラーにする)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_concepts_domain ON concepts(domain_id);
CREATE INDEX idx_concepts_tags ON concepts USING GIN (tags);
-- 3 階層固定ルール + 出題可能性の DB 側不変条件
ALTER TABLE concepts ADD CONSTRAINT concepts_difficulty_levels_nonempty_chk
  CHECK (jsonb_typeof(difficulty_levels) = 'array' AND jsonb_array_length(difficulty_levels) >= 1);

-- ユーザー (個人用途のため事実上 1 行のみ)
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  timezone TEXT DEFAULT 'Asia/Tokyo',
  daily_goal INTEGER NOT NULL DEFAULT 15,
  notification_time TEXT,                       -- 'HH:mm'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Passkey クレデンシャル (ADR-0004)
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,                          -- credentialId (base64url)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type TEXT,                             -- 'singleDevice' | 'multiDevice'
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  transports JSONB DEFAULT '[]'::jsonb,
  nickname TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX idx_credentials_user ON credentials(user_id);

-- 認証セッション (cookie)
CREATE TABLE sessions_auth (
  id TEXT PRIMARY KEY,                          -- crypto.randomUUID()
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_auth_user ON sessions_auth(user_id);
CREATE INDEX idx_sessions_auth_expires ON sessions_auth(expires_at);

-- WebAuthn チャレンジ一時保管
CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL,                        -- 'register' | 'authenticate'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- 生成済み問題キャッシュ
CREATE TABLE questions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  type TEXT NOT NULL,
  thinking_style TEXT,
  difficulty TEXT NOT NULL,                     -- 'beginner'|…|'principal'
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  rubric JSONB,
  distractors JSONB,                            -- mcq only
  hint TEXT,
  explanation TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  generated_by TEXT,                            -- 'gpt-5'
  prompt_version TEXT,
  retired BOOLEAN NOT NULL DEFAULT FALSE,
  retired_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_served_at TIMESTAMPTZ,
  serve_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_questions_concept_type_style
  ON questions(concept_id, type, thinking_style, difficulty)
  WHERE retired = FALSE;

-- 学習セッション
CREATE TABLE sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                           -- 'daily' | 'deep' | 'custom' | 'review'
  spec JSONB,                                   -- CustomSessionSpec (custom のみ)
  template_id TEXT REFERENCES session_templates(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  question_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_sessions_user_started ON sessions(user_id, started_at DESC);

-- 解答履歴
CREATE TABLE attempts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id),
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  user_answer TEXT,
  correct BOOLEAN,
  score REAL,                                   -- 0.0-1.0
  self_rating SMALLINT,                         -- 1-5
  elapsed_ms INTEGER,
  feedback TEXT,
  rubric_checks JSONB,
  misconception_tags JSONB,
  reason_given TEXT,
  copied_for_external INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 全文検索用 tsvector (日本語は pg_trgm 併用)
  search_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(user_answer, '') || ' ' || coalesce(reason_given, '') || ' ' || coalesce(feedback, '')
    )
  ) STORED
);

CREATE INDEX idx_attempts_user_concept ON attempts(user_id, concept_id);
CREATE INDEX idx_attempts_user_created ON attempts(user_id, created_at DESC);
CREATE INDEX idx_attempts_search ON attempts USING GIN (search_tsv);
CREATE INDEX idx_attempts_trgm ON attempts USING GIN (user_answer gin_trgm_ops);

-- FSRS 状態 (concept 単位)
CREATE TABLE mastery (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  stability REAL,
  difficulty REAL,
  last_review TIMESTAMPTZ,
  next_review TIMESTAMPTZ,
  review_count INTEGER NOT NULL DEFAULT 0,
  lapse_count INTEGER NOT NULL DEFAULT 0,
  mastered BOOLEAN NOT NULL DEFAULT FALSE,
  mastery_pct REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, concept_id)
);

CREATE INDEX idx_mastery_next_review ON mastery(user_id, next_review);

-- 誤概念トラッカー
CREATE TABLE misconceptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  description TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INTEGER NOT NULL DEFAULT 1,
  resolved BOOLEAN NOT NULL DEFAULT FALSE
);

-- Custom Session テンプレ
CREATE TABLE session_templates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  raw_request TEXT,
  spec JSONB NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 日次集計キャッシュ
CREATE TABLE daily_stats (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  concepts_touched INTEGER NOT NULL DEFAULT 0,
  study_time_sec INTEGER NOT NULL DEFAULT 0,
  domains_touched JSONB DEFAULT '[]'::jsonb,
  PRIMARY KEY (user_id, date)
);

-- 拡張 (初回マイグレーションで一度だけ)
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
```

### 6.2.3. インデックス設計の指針

- 頻出クエリ: 「ユーザー × concept」「ユーザー × 時系列」
- FSRS スケジューラは `next_review <= now()` のスキャンが必須 → B-tree index
- 全文検索: `tsvector` に GIN + `pg_trgm` を併用 (日本語は語境界が曖昧なので trigram が効く)
- JSONB カラム (`tags` / `spec`) は必要に応じて GIN index を追加

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
custom.parse({ raw: string })  // raw は trim 後 1..2000 字
  → { spec: CustomSessionSpec, promptVersion: string, model: string }

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
  const due = query(
    `
    SELECT c.*, m.stability, m.lapse_count
    FROM mastery m
    JOIN concepts c ON m.concept_id = c.id
    WHERE m.user_id = ? AND m.next_review <= ?
    ORDER BY m.next_review ASC
  `,
    [userId, Date.now()],
  );

  // 2. Blind spots (prereq 全て習得済 & 未着手)
  const blindSpots = query(
    `
    SELECT c.*
    FROM concepts c
    LEFT JOIN mastery m ON m.concept_id = c.id AND m.user_id = ?
    WHERE m.review_count IS NULL
      AND prereqs_satisfied(c, ?)
    LIMIT 2
  `,
    [userId, userId],
  );

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

| レイヤ            | 採用技術                                                       | 理由                                               |
| ----------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| Framework         | **Next.js 15 (App Router)**                                    | SSR/ISR 柔軟、Route Handlers で API 統合           |
| Language          | **TypeScript (strict)**                                        | 型安全                                             |
| Runtime           | **Node.js 22 LTS**                                             | Vercel デフォルト、安定運用                        |
| パッケージ管理    | **pnpm 10.x**                                                  | ADR-0002                                           |
| DB                | **Neon (PostgreSQL 16+)**                                      | ADR-0003。Vercel 公式統合、tsvector/GIN による FTS |
| DB ドライバ       | **`@neondatabase/serverless`**                                 | HTTP fetch 経由、Edge runtime 互換                 |
| ORM               | **Drizzle (pg dialect)**                                       | 型安全、マイグレーション直感的                     |
| API               | **tRPC**                                                       | 型安全 RPC                                         |
| Auth              | **Passkey (WebAuthn)** — `@simplewebauthn/server` + `/browser` | ADR-0004。パスワード / OAuth 併設しない            |
| LLM               | **OpenAI API (`gpt-5` / `gpt-5-mini`)**                        | ADR-0005                                           |
| UI                | **shadcn/ui + Tailwind**                                       | 短時間で整った UI                                  |
| Code Editor       | **CodeMirror 6**                                               | 軽量、モバイル可                                   |
| Charts (Phase 2+) | **Recharts**                                                   | MVP はテキスト表のみ                               |
| State             | **TanStack Query + Zustand**                                   | サーバー状態 + UI 状態                             |
| URL 状態          | **nuqs**                                                       | フィルタなどの URL 同期                            |
| i18n              | 日本語のみ                                                     | スコープ絞る                                       |
| PWA               | **自作 Service Worker** (`public/sw.js`)                       | Serwist / next-pwa は未導入 (依存削減のため)       |
| Deploy            | **Vercel Hobby**                                               | Next.js と Neon の連携が公式                       |
| 監視              | **Sentry (Free tier)**                                         | エラー追跡                                         |
| テスト            | **Vitest**                                                     | unit/integration                                   |
| メール (Phase 3+) | **Resend**                                                     | Weekly Digest / reminder                           |

### 6.5.2. 意図的に MVP で入れないもの

| 技術                        | 入れない理由                     | 再検討タイミング             |
| --------------------------- | -------------------------------- | ---------------------------- |
| Upstash Redis               | 1 ユーザーで rate limit 不要     | 公開時 or 並列ユーザー発生時 |
| PostHog                     | Insights 画面で代用              | 公開時                       |
| Logtail                     | Sentry + Vercel ログで十分       | ログ量増加時                 |
| Web Push                    | iOS PWA 制約 (`7.5.5`)           | Phase 5+                     |
| `gpt-5` with high reasoning | コスト高、MVP は通常推論で足りる | Phase 2+                     |
| Judge0 (コード実行)         | MVP 対象外                       | Phase 6                      |
| OAuth (Google / GitHub)     | Passkey 一本 (ADR-0004)          | 公開時                       |

### 6.5.3. メモ

- Neon 無料枠: 0.5GB / 3 プロジェクト / 常時接続 (Autosuspend あり)。個人用で十分
- Passkey 実装は 200 行程度で完結、外部依存は `@simplewebauthn/*` のみ

---

## 6.6. 環境と構成

### 6.6.1. 環境

- `development` — ローカル Next.js + Neon の dev branch
- `preview` — Vercel Preview + Neon の preview branch
- `production` — Vercel Prod + Neon prod branch

### 6.6.2. 主要な環境変数

```
# MVP で必要
DATABASE_URL=                # Neon: postgresql://user:pass@host/db?sslmode=require
OPENAI_API_KEY=
SESSION_COOKIE_SECRET=       # openssl rand -hex 32
WEBAUTHN_RP_ID=              # 開発時 'localhost', 本番は 'tanren.example.com'
WEBAUTHN_RP_NAME=Tanren
WEBAUTHN_ORIGIN=              # 開発時 http://localhost:3000, 本番は https://tanren.example.com
NEXT_PUBLIC_APP_URL=
SENTRY_DSN=
SENTRY_AUTH_TOKEN=

# Phase 3+ で追加
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# Phase 5+ で追加
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
UPSTASH_REDIS_URL=
UPSTASH_REDIS_TOKEN=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=
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
│   ├── manifest.webmanifest       # PWA manifest (issue #24)
│   ├── sw.js                      # PWA Service Worker (自作、Serwist 非採用)
│   ├── icon-192.png               # PWA アイコン (standard + maskable)
│   ├── icon-512.png               # PWA アイコン (standard + maskable)
│   └── apple-icon.png             # iOS apple-touch-icon (180x180)
├── drizzle/                       # マイグレーション
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── drizzle.config.ts
└── README.md
```

---

## 6.8. セキュリティ

### 6.8.1. 認証 (Passkey, ADR-0004)

- WebAuthn Passkey のみ。パスワード / OAuth は採用しない
- ライブラリ: `@simplewebauthn/server` + `@simplewebauthn/browser`
- 登録/認証フロー
  1. `POST /api/auth/register/options` → チャレンジを `webauthn_challenges` に保存して返す
  2. ブラウザで `navigator.credentials.create()` または `.get()` → 署名
  3. `POST /api/auth/register/verify` or `.../authenticate/verify` でサーバー検証
  4. OK なら `sessions_auth` に行を挿入、HTTP-only cookie (`__Host-tanren_session`) 発行
- セッション有効期限: 30 日 sliding (`last_active_at` 更新で延長)
- 初期ユーザー作成は `pnpm run auth:bootstrap` で CLI から 1 度だけ

### 6.8.2. 認可

- tRPC `protectedProcedure` が cookie → `sessions_auth` lookup → `users.id` を context に注入
- すべての DB クエリに `user_id` フィルタを**必ず**付ける (Drizzle で共通ラッパ)
- 個人用途のため行レベルセキュリティ (RLS) は導入しない。将来公開する場合は Neon の RLS に移行

### 6.8.3. データ保護

- API キー類はサーバー側のみ (`NEXT_PUBLIC_*` 接頭辞を LLM 系キーに使わない)
- Neon は at-rest で暗号化済み
- Sentry には PII を送らない (`beforeSend` で絞る)
- セッション cookie は `__Host-` prefix / `Secure` / `HttpOnly` / `SameSite=Lax`

### 6.8.4. レート制限

- 個人用途のためユーザー単位の厳密な制限は不要
- **暴走防止の保険** として、サーバーのプロセスメモリ上で 1 分 30 リクエストの簡易スロットリングのみ導入
- OpenAI ダッシュボードの Usage limit $20/月が主防衛線

---

## 6.8a. テスト戦略

個人開発なので網羅性より **「壊れたらすぐ気付く」** を優先。

### 6.8a.1. 必ず書く (MVP)

| 対象                                                  | テスト種別      | ツール                            |
| ----------------------------------------------------- | --------------- | --------------------------------- |
| FSRS スケジューラ (`ts-fsrs` ラッパ)                  | unit            | Vitest                            |
| Daily Drill 優先度計算                                | unit            | Vitest                            |
| マスタリー計算式                                      | unit            | Vitest                            |
| NL → CustomSessionSpec パーサ (出力JSON の妥当性検証) | unit + contract | Vitest + Zod                      |
| 採点プロンプトの回帰                                  | snapshot        | Vitest + LLM 実呼出 (手動 opt-in) |
| tRPC ルータの型整合                                   | tsc             | TypeScript strict                 |

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

| レイヤ       | ツール                                                                     |
| ------------ | -------------------------------------------------------------------------- |
| エラー       | Sentry (Free tier)                                                         |
| ログ         | Vercel Logs (直近 1h)、必要なときだけ tail                                 |
| LLM トレース | 独自ログ (prompt_version, 生成/採点結果を `attempts` / `questions` に記録) |

### 6.9.2. Phase 5+ で追加検討

| レイヤ         | ツール                       |
| -------------- | ---------------------------- |
| プロダクト分析 | PostHog (公開時のみ)         |
| パフォーマンス | Vercel Analytics             |
| 長期ログ保存   | Logtail (ログ量が増えてから) |
