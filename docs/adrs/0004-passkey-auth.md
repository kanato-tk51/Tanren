# ADR-0004: 認証を Clerk → Passkey (WebAuthn) に変更

- **Status**: Superseded by ADR-0006
- **Date**: 2026-04-18
- **Supersedes**: `docs/06-architecture.md` の認証節 + `OPEN_QUESTIONS.md` Q8
- **Superseded by**: ADR-0006 (GitHub OAuth)

> **Note**: 本 ADR は ADR-0006 (2026-04-19) に置き換えられた。rp_id=localhost のスコープ問題と初回登録 UI の欠落により体験ハードルが高く、個人 1 人運用のメリットが薄かった。詳細は ADR-0006 の Context 参照。以下は歴史的コンテキストとして残す。

## Context

初期設計は Clerk (OAuth / Google / GitHub) を採用していた。
個人 1 ユーザーなので Clerk は機能過剰だが、開発速度を優先していた。

作者が日常的に Passkey を使っており、1-2 台の端末で完結する個人プロダクトなら
**Passkey (WebAuthn) + 自前セッション** が最も軽量かつ安全と判断。

## Decision

認証は **WebAuthn Passkey 一本**。OAuth / Password はサポートしない。

### 実装

- ライブラリ: **`@simplewebauthn/server`** + **`@simplewebauthn/browser`**
- 登録/認証フロー:
  1. 初回: 本人が Passkey を登録 (ブラウザ/OS の生体認証)
  2. 以降: `POST /api/auth/challenge` → 署名 → サーバー検証 → セッション cookie 発行
- セッション:
  - HTTP-only / Secure / SameSite=Lax cookie
  - セッションID は DB `sessions_auth` テーブルで管理 (CustomSession ではなく認証用)
  - 有効期限: 30 日 (Sliding window)
- 保護 route:
  - Next.js Middleware + tRPC `protectedProcedure` で cookie 検証
  - middleware でセッション無効ならログイン画面にリダイレクト

### DB 追加テーブル

```sql
-- ユーザーの Passkey クレデンシャル (複数デバイス対応)
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,              -- credentialId (base64url)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type TEXT,                 -- 'singleDevice' | 'multiDevice'
  backed_up BOOLEAN DEFAULT FALSE,
  transports TEXT,                  -- JSON array ('internal','hybrid',...)
  nickname TEXT,                    -- 'MacBook Pro 2024'
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- 認証セッション (FSRS の sessions テーブルとは別物)
CREATE TABLE sessions_auth (
  id TEXT PRIMARY KEY,              -- session cookie 値 (crypto.randomUUID)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sessions_auth_user ON sessions_auth(user_id);

-- チャレンジの一時保管 (登録/認証時)
CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL,            -- 'register' | 'authenticate'
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
```

### 初期ユーザー作成

- アプリに「新規登録」フォームは作らない (個人用)
- 初回は `pnpm run auth:bootstrap` スクリプトで作者のメールアドレス + Passkey を登録
- 以降、登録済み端末が破損した場合に備えて **複数端末の Passkey を許可**

## Consequences

**Good:**

- パスワード漏洩リスクゼロ、フィッシング耐性
- Clerk への月額 0 円、外部依存 1 つ削減
- 実装はシンプル (200 行程度)
- セッション管理も自前なので完全にコントロール

**Bad:**

- Passkey 未対応のブラウザ / 端末に出会うとどうにもならない
  → 個人用なので実害なし。Chrome/Safari モダン版で動けば OK
- 端末を全部なくすと詰む → Passkey は iCloud Keychain / Google Password Manager で同期される前提
- 将来公開する気になったら **OAuth / Magic Link を追加** する必要

**後戻りコスト:**

- 公開前提に切り替わった時点で Auth.js / Clerk / Lucia に差し替え可能
- セッション層のインタフェース (`getCurrentUser()` など) を薄く作っておけば影響は tRPC middleware 局所で済む
