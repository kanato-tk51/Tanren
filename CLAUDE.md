# CLAUDE.md — AI 開発アシスト用の規約

このファイルは Claude Code / Codex / Copilot など AI コーディングアシスタントが
このリポジトリで作業するときに参照する規約集。**作業前に必ず読むこと**。

---

## 0. まず読むもの

- `AGENTS.md` — Next.js 最新版の注意 (学習データより後の breaking change に注意)
- `docs/README.md` — 設計ドキュメントの目次
- `docs/08-mvp-roadmap.md` — 今どのフェーズにいるか
- `docs/OPEN_QUESTIONS.md` — 決まっていない論点 (勝手に決めない)

## 1. プロジェクトの前提

- **作者 1 人が使う個人プロジェクト**。商用展開の予定なし
- マルチテナント / ソーシャル / ゲーミフィケーション機能は**作らない**
- 日本語 UI のみ (i18n 不要)
- 公開の予定が出たら ADR で方針転換

## 2. 技術スタック (決定済み)

詳細は `docs/06-architecture.md` 6.5。要点:

- **Next.js 15 (App Router) + TypeScript strict**
- **Node.js 22 LTS** (Bun は採用しない)
- **pnpm** (npm / yarn / bun は採用しない)
- **Neon (PostgreSQL 16+) + Drizzle (pg dialect)** — ADR-0003
- **tRPC**
- **GitHub OAuth 認証** (Authorization Code + PKCE、`fetch` + Zod 直叩き) — ADR-0006 (旧 ADR-0004 Passkey から置き換え)
- **OpenAI API** — MVP は `gpt-5` + `gpt-5-mini`。高 reasoning は Phase 2+ — ADR-0005
- **shadcn/ui + Tailwind**
- **Vitest**
- **Vercel** (Hobby) + Neon の Vercel 統合

## 3. 禁止事項 (やらないで)

| やらない                                         | 理由                              |
| ------------------------------------------------ | --------------------------------- |
| Bun / Deno に差し替え                            | Vercel 相性、決定済み (`06.5.1`)  |
| 他 LLM プロバイダ (Anthropic / Google 等) 追加   | OpenAI 一本で行く (ADR-0005)      |
| Turso / SQLite / 他 DB に戻す                    | Neon に確定 (ADR-0003)            |
| Clerk / Auth.js / 追加 OAuth プロバイダ          | GitHub OAuth 一本 (ADR-0006)      |
| Upstash Redis / PostHog / Logtail 追加           | MVP では使わない (`06.5.2`)       |
| Web Push 実装                                    | Phase 5+、メールが先              |
| Streak / バッジ / ポイント                       | ゲーミフィケーション禁止 (`08.9`) |
| 英語 UI / i18n                                   | スコープ外                        |
| マルチテナント / ソーシャル                      | 個人用                            |
| `--no-verify` でコミット                         | 必ずフックを通す                  |
| main に直 push                                   | PR 経由のみ                       |
| docs を変えずに設計変更                          | ドキュメントが真実の源            |
| `difficulty` に `intro/applied/edge_case` を使う | ADR-0001 で廃止済み。6 段階 only  |
| `NEXT_PUBLIC_*` で LLM / DB キーを公開           | サーバー専用変数                  |

## 4. コーディング規約

### 4.1. 型とエラー処理

- `any` は原則禁止。やむを得ず使うなら `// eslint-disable-next-line` で理由を書く
- API 境界は Zod / valibot でパース
- 想定外エラーは握りつぶさない。Sentry に送る

### 4.2. 命名

- ファイル: `kebab-case.ts`
- 型 / コンポーネント: `PascalCase`
- 関数 / 変数: `camelCase`
- concept ID: `domain.subdomain.name` の snake_case (`10-taxonomy-seed.md`)
- DB カラム: `snake_case`、TS プロパティ: `camelCase` (Drizzle が吸収)

### 4.3. コメント

- **デフォルトでコメントなし**
- 書く必要があるのは「なぜその実装なのか」が読んで分からないときだけ
- 「何をしているか」はコード自身で説明する
- 過去の経緯・TODO・ハック理由は残してよい

### 4.4. ファイル配置

- **`src/features/<name>/`** — UI + state + server-side ロジックの単位
- **`src/server/trpc/`** — ルータ
- **`src/server/scheduler/`**, **`src/server/generator/`**, **`src/server/grader/`**, **`src/server/parser/`**, **`src/server/insights/`** — ドメインロジック
- **`src/db/schema/`** — Drizzle スキーマ (テーブル単位でファイル分割)
- **`src/lib/`** — 横断ユーティリティ (`anthropic.ts`, `fsrs.ts` など)
- **`prompts/`** — LLM プロンプトテンプレ (`.md` で管理)

### 4.5. プロンプトの扱い

- プロンプトは `prompts/{generation|grading|parsing}/<name>.v<n>.md` で版管理
- テンプレ関数で変数を注入、テンプレ文字列直書きしない
- 呼び出し時 `attempts.prompt_version` または `questions.prompt_version` に記録
- OpenAI の **自動 prompt caching** のため、**共通 prefix は必ず先頭**に配置 (順序崩さない)

### 4.6. LLM 呼び出しは 1 箇所に集約

- すべての OpenAI 呼び出しは `src/lib/openai/client.ts` のラッパ経由のみ
- モデル名は `src/lib/openai/models.ts` の定数から (文字列リテラル散らばり禁止)
- 将来 provider を差し替える可能性を考慮、ドメインロジックから直接 `openai.*` を呼ばない

### 4.7. DB アクセス

- すべての DB クエリは Drizzle 経由
- `src/db/schema/` のテーブル定義が真実の源、手書き SQL は最小限に
- 認証が必要なクエリは必ず `user_id` を where 句に含める (共通 helper `withUser(userId)` を使う)

### 4.8. 認証

- 認証ロジックは `src/server/auth/` に集約 (`@simplewebauthn/*` のラッパ)
- tRPC の `protectedProcedure` を通ったハンドラでは `ctx.user` が常に存在する前提で書ける
- cookie 名 `__Host-tanren_session` を変えない (CSRF 耐性のため prefix 必須)

### 4.9. 環境変数

- **ローカルに `.env.local` を作らない**。Vercel の Development 環境が唯一の真実
- 開発サーバーは `pnpm dev` (= `vercel dev`)、CLI は `./scripts/with-vercel-env.sh <cmd>` で env 注入
- 新しい env 変数を追加するときは:
  1. `.env.example` に名前とコメントを追加 (ドキュメント代わり)
  2. `pnpm dlx vercel env add <NAME> development preview production` で Vercel に登録
  3. `docs/06-architecture.md` 6.6.2 の一覧を同期

## 5. docs/ と実装の同期

**ドキュメントは実装と同期して更新するのが絶対ルール**。

- 挙動が docs と変わったら、実装と同じ PR で docs も更新
- 方針が変わったら ADR を追加
- 「実装が先で docs は後で」という借金は作らない
- 迷ったら `docs/OPEN_QUESTIONS.md` に寝かせる

## 6. テスト方針 (再掲: `06.8a`)

MVP で書く:

- FSRS スケジューラ / Daily Drill 優先度 / マスタリー計算 — unit (Vitest)
- NL パーサの出力 JSON 妥当性 — contract (Zod)
- tRPC ルータの型整合 — `tsc`

書かない:

- UI の E2E (自分が触るので十分)
- 採点プロンプトの全組合せ網羅

## 7. コミット / PR

- Conventional Commits 準拠 (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`)
- 1 PR = 1 論点。横断的な変更と機能追加は分ける
- PR テンプレートのチェックを埋める (`.github/pull_request_template.md`)
- ブランチ命名: `feat/<name>`, `fix/<name>`, `docs/<name>`

## 8. AI アシストに期待すること

### やってほしい

- 実装前に `docs/` の該当箇所を確認し、矛盾があれば指摘する
- テストも一緒に書く
- 型を厳密に (`any` を返す関数を作らない)
- OpenAI API 呼び出しは `src/lib/openai/client.ts` 経由に統一する
- 認証関連は `src/server/auth/` 経由、GitHub OAuth の token 交換等を UI / tRPC 層から直接叩かない

### やらないでほしい

- 勝手に MVP スコープを広げる (`08.2.2` の Out リスト参照)
- 勝手にライブラリを追加する (必要なら理由を書いて提案)
- docs の更新を後回しにする
- 決まっていない論点を勝手に決める (`OPEN_QUESTIONS.md`)
- `--no-verify` で hook を飛ばす

## 9. claude-vs-codex スキルとの連携

作者は `~/.claude/commands/claude-vs-codex` スキルを使って、
Codex による review を Claude の実装にかぶせることがある。

- Codex の review コメントは Claude の実装に対する他者視点として扱う
- 20 ラウンド上限、0 issues で終了

## 10. 困ったとき

- この CLAUDE.md で判断できないこと → `docs/OPEN_QUESTIONS.md` を確認
- それでも不明 → 作業を止めて作者に質問する。**決め打ちで進めない**
