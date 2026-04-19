# 開発環境セットアップ手順

実装着手前のセットアップと、ローカル開発・リポジトリ運用のメモ。

---

## 1. 初回のみ: ローカル環境

### 1.1. 必要ツール

- **Node.js 22 LTS** — `nvm install` で `.nvmrc` 準拠
- **pnpm 10.x** — `corepack enable` 経由推奨
- **psql** (任意) — Neon への直接アクセス用。`brew install libpq` で取得可
- **Git**

### 1.2. 認証準備

以下のサービスでアカウントを作る (無料枠):

- [Neon](https://neon.tech/) — Project 1 個。`dev` と `prod` の branch を切る
- [OpenAI](https://platform.openai.com/) — API キー取得、**Settings → Limits で Usage limit を $20/月**に設定
- [Sentry](https://sentry.io/) — Next.js プロジェクト 1 個
- [Vercel](https://vercel.com/) — Hobby、Git 連携 + Neon integration を有効化
- **GitHub OAuth App** (ADR-0006) — GitHub の Settings → Developer settings → OAuth Apps → New OAuth App:
  - Application name: `Tanren (dev)` / `Tanren (preview)` / `Tanren (prod)` を環境ごとに分ける
  - Authorization callback URL: それぞれ
    - dev: `http://localhost:3000/api/auth/github/callback`
    - preview: `https://<your-vercel-preview>.vercel.app/api/auth/github/callback`
    - prod: `https://<your-prod-domain>/api/auth/github/callback`
  - Client ID / Client Secret を `.env` / Vercel env に投入する (§1.3)

### 1.3. 環境変数

**このプロジェクトではローカルに `.env.local` を置かない**運用にする。
Vercel の Development 環境に登録した変数を `vercel dev` / `with-vercel-env.sh` 経由で
ランタイムに注入する (§5 参照)。

```bash
pnpm dlx vercel login   # 初回のみ
pnpm dlx vercel link    # 初回のみ、このディレクトリをプロジェクトに紐付け
```

`.env.example` は「Vercel の env にどんな変数があるべきか」のドキュメント代わり。

---

## 2. Phase 0 Day 1 — Next.js 初期化手順

着手時にこのコマンドで Next.js をセットアップする。既に用意した設定ファイル
(`.gitignore`, `.editorconfig`, `CLAUDE.md` 等) はそのまま残すので、Next.js の生成物と
マージする運用。

```bash
# リポジトリルートで
pnpm create next-app@latest . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --turbopack \
  --import-alias "@/*"

# 初期依存を追加 (MVP 必須)
# ADR-0006: GitHub OAuth は素の fetch + zod で実装するため @simplewebauthn 系は不要
pnpm add openai \
         @neondatabase/serverless drizzle-orm drizzle-zod \
         @trpc/server @trpc/client @trpc/react-query @trpc/next \
         @tanstack/react-query zod ts-fsrs nuqs zustand \
         @sentry/nextjs

pnpm add -D drizzle-kit vitest @vitest/coverage-v8 @vitejs/plugin-react \
            @testing-library/react @testing-library/user-event \
            prettier prettier-plugin-tailwindcss eslint-config-prettier \
            lefthook tsx
```

その後 `package.json` の `scripts` に以下を足す:

<!-- prettier-ignore -->
```jsonc
{
  "scripts": {
    "dev": "vercel dev",
    "dev:local": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "next lint",
    "format": "prettier --write .",
    "test": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "./scripts/with-vercel-env.sh drizzle-kit migrate",
    "db:seed": "./scripts/with-vercel-env.sh tsx src/db/seed/run.ts",
    "db:studio": "./scripts/with-vercel-env.sh drizzle-kit studio",
    "auth:bootstrap": "./scripts/with-vercel-env.sh tsx src/server/auth/bootstrap.ts",
    "prepare": "lefthook install"
  },
  "packageManager": "pnpm@10.0.0",
  "engines": { "node": ">=22.0.0 <23.0.0" }
}
```

- `pnpm dev` = `vercel dev` (クラウドから env 取得、推奨)
- `pnpm dev:local` = 素の `next dev` (Vercel API オフライン時のフォールバック。動かすには一時的に `.env.local` を作る)

最後に lefthook を有効化:

```bash
pnpm lefthook install
```

---

## 3. GitHub 側の初回設定 (手動)

このリポジトリの運用ルールは GitHub Web UI から設定する必要がある。

### 3.1. ブランチ保護 (必須)

**Settings → Branches → Add branch ruleset** で `main` に対して:

- ✅ **Require a pull request before merging**
  - Require approvals: 0 (個人開発なのでセルフマージ OK)
  - ✅ Dismiss stale pull request approvals when new commits are pushed
- ✅ **Require status checks to pass before merging**
  - ✅ Require branches to be up to date before merging
  - 必須チェック: `check` (ci.yml の job)
- ✅ **Require conversation resolution before merging**
- ❌ Require signed commits (将来やる)
- ❌ Allow force pushes / Allow deletions

### 3.2. Actions 権限

**Settings → Actions → General**:

- Workflow permissions: **Read repository contents and packages permissions** (デフォルト)
- Allow GitHub Actions to create and approve pull requests: **無効**

### 3.3. Secrets (後日、デプロイ時)

CD は Vercel の Git 統合でデプロイするので、**GitHub Secrets は不要**。
環境変数はすべて Vercel 側の Environment Variables で管理する。

### 3.4. Renovate / Dependabot (任意、Phase 2+)

`.github/dependabot.yml` を追加して weekly で依存更新 PR を自動作成。

---

## 4. デプロイ戦略 (Preview + 手動 CD)

```
feat/xxx ─PR→ main ─自動→ Vercel Preview   (Neon: ephemeral branch)
                │
                └ workflow_dispatch → production ─自動→ Vercel Production  (Neon: main branch)
```

### 4.1. Vercel 側の初回セットアップ

1. Vercel にログインして `kanato-tk51/Tanren` を **Import**
2. **Settings → Git → Production Branch** を `main` から **`production`** に変更
   - これで main への push は Preview 扱いになる
3. **Settings → Environment Variables** に `.env.example` のキーを登録
   - `Production` / `Preview` / `Development` の 3 env に分けて入れる
   - `DATABASE_URL` は Production のみ実値、Preview は Neon Integration が自動注入 (後述)
   - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_ALLOWED_USER_ID` / `NEXT_PUBLIC_APP_URL` は env ごとに別値 (OAuth App も env ごとに分けて callback URL を登録する)
4. **Integrations → Neon** を有効化
   - Vercel Project と Neon Project を接続
   - 「Automatic database branching for previews」を **ON**
   - Preview ごとに Neon の ephemeral branch が自動作成、`DATABASE_URL` が自動注入される

### 4.2. Neon 側の初回セットアップ

1. Project 1 個 (`tanren`) を作成
2. デフォルトの `main` branch が本番 DB
3. Vercel Integration により Preview 用の branch が必要に応じて作られる
4. 接続文字列をコピーして Vercel の **Production** 環境変数 `DATABASE_URL` に貼る

### 4.3. 本番デプロイ手順 (日常運用)

```
1. feat ブランチで実装 → PR → main にマージ
2. GitHub Actions で CI (typecheck / lint / test / build) が自動実行
3. Vercel が main を検知 → Preview URL を生成 (commit ごと)
4. Preview URL で動作確認
5. 問題なければ:
   GitHub → Actions → "deploy-prod" → Run workflow
   → 入力欄に "deploy" と打って実行
6. main が production に fast-forward push される
7. Vercel が production を検知 → 本番デプロイ開始
```

### 4.4. ロールバック

- Vercel ダッシュボード → Deployments → 古いコミットを Promote する (最速)
- あるいは main で revert コミット → workflow_dispatch で deploy-prod を再実行

---

## 5. 開発時の env 変数運用

### 5.1. 基本方針

- **`.env.local` をローカルに作らない** (秘密情報をディスクに落とさない)
- **Vercel の Development 環境** に登録した変数を `vercel dev` が自動注入
- CLI スクリプト (drizzle-kit, tsx など) は `scripts/with-vercel-env.sh` ラッパ経由で実行

### 5.2. 通常の開発サーバー起動

```bash
pnpm dev       # 実体は `vercel dev`
```

起動時に Vercel API から Development env 変数を取得し、Next.js に注入。終了するとメモリから消える。
**`.env.local` は作らない**。

### 5.3. CLI スクリプトを env 付きで走らせる

```bash
pnpm db:migrate       # 内部で ./scripts/with-vercel-env.sh 経由
pnpm db:seed
pnpm db:studio
pnpm auth:bootstrap <github_user_id> [displayName] [email]   # ADR-0006: GitHub user id で紐付け
```

このラッパは:

1. `vercel env pull` で `mktemp` の一時ファイルに Development env を取得
2. `source` して `export` し、引数のコマンドを実行
3. 終了時に trap で一時ファイルを必ず削除

### 5.4. 別環境を触りたいとき (稀)

```bash
WITH_VERCEL_ENV_TARGET=preview ./scripts/with-vercel-env.sh pnpm tsx scripts/debug.ts
WITH_VERCEL_ENV_TARGET=production ./scripts/with-vercel-env.sh pnpm db:studio
```

### 5.5. 注意点

- オフラインで動かない (Vercel API 呼び出しが必要)
- 初回は `vercel link` が必須
- CI では env を Vercel から取らず、ダミー値を GitHub Actions の `env:` で渡す (現行設定どおり)

---

## 6. 日々の開発フロー

```bash
# 1. 最新 main を取得
git checkout main && git pull

# 2. ブランチを切る
git checkout -b feat/xxx

# 3. 実装 (lefthook が pre-commit で format/lint/typecheck)
pnpm dev
...

# 4. コミット (Conventional Commits 形式)
git commit -m "feat: 採点結果画面にコピーボタンを追加"

# 5. push & PR
git push -u origin feat/xxx
gh pr create
```

PR テンプレートのチェックを埋めて、CI が緑なら self-approve でマージ。

---

## 7. トラブルシュート

| 症状                                                                           | 対処                                                                         |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `pnpm install` が遅い                                                          | `.pnpm-store` の場所を SSD に (`pnpm config set store-dir`)                  |
| CI がずっと skip                                                               | Phase 0 前は `package.json` が無いため意図通り。Day 1 で解消                 |
| `/login?error=forbidden` が出る                                                | `GITHUB_ALLOWED_USER_ID` と自分の GitHub user id が一致するか確認 (ADR-0006) |
| `/login?error=not_bootstrapped`                                                | `pnpm auth:bootstrap <github_user_id>` を先に実行する                        |
| Neon で `SSL required`                                                         | 接続文字列の末尾に `?sslmode=require` を付ける                               |
| OpenAI `rate_limit`                                                            | Usage limit に到達していないか確認、モデル/Tier を見直す                     |
| `pnpm install` で `lefthook install` が `core.hooksPath is set locally` で失敗 | 下記 **7.1 を参照** (issue #45)                                              |

### 7.1. `core.hooksPath` 衝突で `lefthook install` が失敗する場合

`pnpm install` で `prepare` スクリプトの `lefthook install` が以下のエラーで落ちることがある:

```
Error: core.hooksPath is set locally to '/path/to/Tanren/.git/hooks'
hint: Unset it:
hint:   git config --unset-all --local core.hooksPath
```

ローカルの `git config core.hooksPath` がデフォルトと同じ `.git/hooks` に**明示的にセット**されていると、lefthook が「他ツールが hooksPath を差し替えている可能性がある」と判断して上書きを拒否するために発生する。値はデフォルトパスと同じなので機能上の意味はなく、単に `git` の内部状態が「未設定」と「明示セット」で扱いが違うだけ。

**対処 (どちらか 1 つ)**:

```bash
# A) 明示セットを外す (推奨、未設定に戻るので副作用なし)
git config --unset-all --local core.hooksPath
pnpm install

# B) lefthook の --reset-hooks-path で unset を自動化する (A と同じ効果)
pnpm lefthook install --reset-hooks-path
```

`prepare` スクリプトに `--force` / `--reset-hooks-path` を入れる案もあるが、他ツールが hooksPath を意図的に差し替えているケースを黙って上書きしてしまうため採用しない (個人プロダクトでも他人の環境に副作用を残さない方針)。
