# Tanren (鍛錬)

> **エンジニアが毎日使うための AI 家庭教師**
> 問題を解いて、Claude が採点し、忘れる前に再出題する。個人開発プロジェクト。

[![ci](https://github.com/kanato-tk51/Tanren/actions/workflows/ci.yml/badge.svg)](https://github.com/kanato-tk51/Tanren/actions/workflows/ci.yml)

## 概要

Tanren は 1 人のエンジニア (作者) が日々の CS 学習を継続するための PWA。
OpenAI API で問題を動的生成し、FSRS で記憶曲線に沿って再出題する。

- **ターゲット**: 作者本人 (1-2 年目エンジニア)
- **ユースケース**: 通勤・休憩時間に 10-15 分
- **MVP ドメイン**: programming / dsa / network / db / tools / frontend

詳細な設計は [`docs/`](./docs/) を参照。

## Quick Start

```bash
# 前提: Node 22 LTS (nvm use)、pnpm
pnpm install
pnpm dlx vercel login        # 初回のみ
pnpm dlx vercel link         # 初回のみ、このディレクトリをプロジェクトに紐付け
pnpm db:migrate              # Neon にスキーマ適用 (env は Vercel から自動注入)
pnpm db:seed                 # 知識ツリー seed
pnpm auth:bootstrap <github_user_id> [displayName] [email]  # 初回のみ: 作者の user 行を作成 (ADR-0006)
pnpm dev                     # vercel dev で http://localhost:3000
```

環境変数は **Vercel の Development 環境**で管理 (`.env.local` はローカルに置かない方針)。
詳細は [`docs/DEV_SETUP.md §5`](./docs/DEV_SETUP.md) を参照。

環境変数の詳細は [`docs/06-architecture.md#662`](./docs/06-architecture.md) 参照。

## ディレクトリ構成 (予定)

```
Tanren/
├── docs/                  # 設計ドキュメント (最重要、まずここを読む)
├── src/                   # アプリケーションコード
│   ├── app/               # Next.js App Router
│   ├── server/            # tRPC, scheduler, generator, grader
│   ├── db/                # Drizzle スキーマ + seed
│   ├── features/          # フィーチャーモジュール
│   ├── components/ui/     # shadcn/ui
│   └── lib/               # 共通ユーティリティ
├── prompts/               # LLM プロンプトテンプレ (version 管理)
├── drizzle/               # マイグレーション
└── .github/               # CI / PR テンプレ
```

着手前なので `src/` 以下はまだ存在しない。`docs/08-mvp-roadmap.md` の Phase 0 から開始する。

## 主要スクリプト (予定)

<!-- prettier-ignore -->
| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発サーバ |
| `pnpm build` | 本番ビルド |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier 適用 |
| `pnpm test` | Vitest |
| `pnpm db:migrate` | Drizzle マイグレーション |
| `pnpm db:seed` | concept seed 投入 |

## 技術スタック

`docs/06-architecture.md` 参照。要点:

- **Next.js 15 (App Router)** + TypeScript strict + tRPC
- **Neon (PostgreSQL 16+)** + Drizzle (ADR-0003)
- **GitHub OAuth** 認証 (ADR-0006、旧 ADR-0004 Passkey から置換)
- **OpenAI API** (`gpt-5` / `gpt-5-mini`) (ADR-0005)
- **shadcn/ui** + Tailwind
- **Vitest** (テスト)
- **Vercel** (デプロイ)

## ドキュメント

設計ドキュメントは `docs/` に一式。

<!-- prettier-ignore -->
| # | ファイル | 内容 |
|---|---|---|
| 01 | [vision](./docs/01-vision.md) | プロダクトの目的 |
| 02 | [learning-system](./docs/02-learning-system.md) | タクソノミ・SRS・セッション |
| 03 | [ai-strategy](./docs/03-ai-strategy.md) | Claude API 活用 |
| 04 | [custom-sessions](./docs/04-custom-sessions.md) | ユーザー指定出題 |
| 05 | [insights](./docs/05-insights.md) | 学習状態の診断 |
| 06 | [architecture](./docs/06-architecture.md) | システム構成 |
| 07 | [ux-and-pwa](./docs/07-ux-and-pwa.md) | UX / PWA |
| 08 | [mvp-roadmap](./docs/08-mvp-roadmap.md) | ロードマップ |
| 09 | [risks-and-metrics](./docs/09-risks-and-metrics.md) | リスクと成功指標 |
| 10 | [taxonomy-seed](./docs/10-taxonomy-seed.md) | Tier 1 concept seed |

- [`OPEN_QUESTIONS.md`](./docs/OPEN_QUESTIONS.md) — 先送りした論点
- [`adrs/`](./docs/adrs/) — 設計判断の記録

AI アシスト利用時は [`CLAUDE.md`](./CLAUDE.md) を先に読むこと。
初回セットアップ手順は [`docs/DEV_SETUP.md`](./docs/DEV_SETUP.md) を参照。

## ステータス

2026-04 時点: **設計完了、Phase 0 実装着手前**

## ライセンス

個人プロジェクトのため未設定。
