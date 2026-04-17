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

> Passkey 認証のためのパスワード管理サービスは**不要**。
> 作者端末の iCloud Keychain / Google Password Manager で Passkey を同期する前提。

### 1.3. 環境変数

```bash
cp .env.example .env.local
# 各サービスで取得した値を埋める
```

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
pnpm add openai \
         @simplewebauthn/server @simplewebauthn/browser \
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

```jsonc
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "next lint",
    "format": "prettier --write .",
    "test": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx src/db/seed/run.ts",
    "db:studio": "drizzle-kit studio",
    "auth:bootstrap": "tsx src/server/auth/bootstrap.ts",
    "prepare": "lefthook install"
  },
  "packageManager": "pnpm@10.0.0",
  "engines": { "node": ">=22.0.0 <23.0.0" }
}
```

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

**Settings → Secrets and variables → Actions** に:
- `VERCEL_TOKEN` (Vercel 直デプロイする場合)
- その他は Vercel 側 Environment Variables で管理

### 3.4. Renovate / Dependabot (任意、Phase 2+)

`.github/dependabot.yml` を追加して weekly で依存更新 PR を自動作成。

---

## 4. 日々の開発フロー

```bash
# 1. 最新 main を取得
git checkout main && git pull

# 2. ブランチを切る
git checkout -b feat/xxx

# 3. 実装 (lefthook が pre-commit で format/lint/typecheck)
...

# 4. コミット (Conventional Commits 形式)
git commit -m "feat: 採点結果画面にコピーボタンを追加"

# 5. push & PR
git push -u origin feat/xxx
gh pr create
```

PR テンプレートのチェックを埋めて、CI が緑なら self-approve でマージ。

---

## 5. トラブルシュート

| 症状 | 対処 |
|---|---|
| `pnpm install` が遅い | `.pnpm-store` の場所を SSD に (`pnpm config set store-dir`) |
| CI がずっと skip | Phase 0 前は `package.json` が無いため意図通り。Day 1 で解消 |
| Passkey がブラウザで動かない | `WEBAUTHN_RP_ID` と `WEBAUTHN_ORIGIN` が一致しているか確認 |
| Neon で `SSL required` | 接続文字列の末尾に `?sslmode=require` を付ける |
| OpenAI `rate_limit` | Usage limit に到達していないか確認、モデル/Tier を見直す |
