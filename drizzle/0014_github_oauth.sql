-- issue #71 / ADR-0006: Passkey から GitHub OAuth へ移行
-- 旧 Passkey テーブル 2 つを削除し、users に github_user_id / github_login を追加する。

-- users.email の NOT NULL 制約を外す (GitHub OAuth は email を必須として要求しない)。
-- 旧 Passkey フローでは bootstrap スクリプト経由で email 必須で insert していた行
-- (本 PR 以前のユーザー) はそのまま維持されるが、以後の OAuth 新規 insert では
-- email が null のケースを許容する。
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- GitHub user id (stable、login は変わりうるので id 主体で紐付け) + login を追加
ALTER TABLE "users"
  ADD COLUMN "github_user_id" bigint UNIQUE,
  ADD COLUMN "github_login" text;

-- Weekly Digest は users.email が必須。email IS NULL の既存行では既存の
-- weekly_digest_enabled=true はサイレントに配信対象外になるため、明示的に
-- false に揃えておく (Codex PR#86 Round 2 指摘 #1)。
UPDATE "users" SET "weekly_digest_enabled" = false WHERE "email" IS NULL;

DROP TABLE IF EXISTS "webauthn_challenges";
DROP TABLE IF EXISTS "credentials";
