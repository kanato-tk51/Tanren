# ADR-0006: 認証を Passkey → GitHub OAuth に変更

- **Status**: Accepted
- **Date**: 2026-04-19
- **Supersedes**: ADR-0004 (Passkey)

## Context

ADR-0004 で Passkey (WebAuthn) 単独を採用したが、個人開発用途で実際にセットアップしようとしたところ次のハードルが判明した:

- **初回登録のブートストラップ UI が未実装**: `/api/auth/register/{options,verify}` は存在するが `getCurrentUser()` で既ログインを要求する一方、初回ログインに必要な credential を作る手段が UI に無い (chicken-and-egg)。`src/server/auth/bootstrap.ts` のコメントは「ブラウザ UI から /api/auth/register/\* を叩く」とあるが、対応する UI が `src/features/auth/login-form.tsx` に存在しない。
- **`rp_id = localhost` のスコープ問題**: `localhost` Passkey は iCloud Keychain / Google Password Manager が同期しない。スマホからは「このデバイスに localhost のパスキーがありません」と出て検証不可。実機確認に Vercel Preview + 公開 HTTPS ドメインが毎回必要。
- **クロスデバイス体験**: Preview URL ごとに rp_id が変わるため credential 使い回し不可。
- **復旧パス**: authenticator を全失すると自分でも入れない。CLI で DB に直接 credential を insert しない限り復帰不能。

体験ハードルに比して個人 1 人運用のメリットが薄い。

## Decision

認証は **GitHub OAuth 2.0 Authorization Code flow (PKCE)** 一本に置き換える。
CLAUDE.md §3「Clerk / Auth.js / OAuth を追加」禁止の例外として、**GitHub OAuth のみ許可**、
他プロバイダ (Google / Apple / Magic Link 等) は引き続き追加禁止。

### 理由

- 作者は日常的に GitHub にログイン済み → ワンクリックで入れる
- 失敗復旧は GitHub のアカウント管理側に寄せられる (自前で認証復旧を作らない)
- ドメイン / rp_id の縛りが無く、Preview URL でも本番ドメインでもそのまま動く
- Passkey コードを消した上で 1 プロバイダだけ (素の `fetch` + Zod) で済み、依存は却って減る

### 実装

- **OAuth flow**: Authorization Code + PKCE (S256)
- **Endpoints**:
  - `GET /api/auth/github/login` — `state` + `code_verifier` を生成して cookie に保存、GitHub に 302 リダイレクト
  - `GET /api/auth/github/callback` — `state` 検証、`code` 交換、GitHub user 取得、allowlist 照合、session cookie 発行
- **Session**: ADR-0004 で入れた `sessions_auth` テーブル + `__Host-tanren_session` cookie をそのまま流用
- **Allowlist**: `GITHUB_ALLOWED_USER_ID` env に許可 GitHub user id を 1 人だけ設定。外れたら 403
- **Library**: `@octokit/*` は使わない。OAuth エンドポイント 3 本の直叩き + Zod で JSON を検証

### DB 変更 (migration 0014)

- `users` テーブルに `github_user_id BIGINT UNIQUE` / `github_login TEXT` を追加
- 旧 Passkey テーブル (`credentials`, `webauthn_challenges`) を `DROP`
- `sessions_auth` は変更なし (流用)

### 初期ユーザー作成

- `pnpm auth:bootstrap <github_user_id> [displayName] [email]` で GitHub user id を users に紐付け
  - `email` は既存の users 行 (ADR-0004 Passkey 時代に作られた行) と突合するマイグレーション用キー。省略した場合は、github_user_id=null の user が 1 件だけあればそれに紐付け、なければ新規 insert する。
  - `GITHUB_ALLOWED_USER_ID` が env に設定されていて引数 `github_user_id` と一致しない場合は fail-closed で中止する (callback で `forbidden` になる壊れた行を作らないため)。
- 初回フローは「GitHub でログイン」→ allowlist に該当するか → bootstrap 済みユーザーと突合 → session 発行

## Consequences

**Good:**

- 日常的な GitHub ログイン状態を流用できるためワンクリックで入れる
- rp_id / localhost の縛りが消え、Preview でもスマホでも同じ導線で動く
- ブートストラップ問題が自然解消 (GitHub 認証後に allowlist 照合するだけ)
- 復旧パスは GitHub のアカウント管理に寄せられる

**Bad:**

- GitHub 側の障害で完全に入れなくなる → 個人用なので許容、Vercel 側で事前に退避メッセージを出せる
- 仮に GitHub アカウント垢 BAN 等が起きると復旧不能 → 個人ユース前提で許容

**後戻りコスト:**

- セッション層 (`getCurrentUser` / `sessions_auth`) はそのまま、provider だけ差し替える設計なので、将来 Google 等に広げる際も auth ディレクトリ + env 局所で済む

## 非採用の代替案

- **Auth.js / Clerk / Lucia**: CLAUDE.md §3「外部 auth ライブラリ追加禁止」を維持するため採用しない。素の OAuth2 で十分
- **複数プロバイダ対応**: 個人 1 人運用なので不要。allowlist を 1 エントリに絞ることで仕様を最小化
- **GitHub Device Flow**: ブラウザ UI ありきなので不要
