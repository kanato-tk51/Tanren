-- issue #36: Weekly Digest on/off の opt-out フラグを追加 (デフォルト true)
ALTER TABLE "users"
  ADD COLUMN "weekly_digest_enabled" boolean NOT NULL DEFAULT true;
