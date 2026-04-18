-- issue #26: Onboarding 完了状態 + 興味分野 + 自己申告レベルを users に追加
ALTER TABLE "users"
  ADD COLUMN "onboarding_completed_at" timestamp with time zone,
  ADD COLUMN "interest_domains" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN "self_level" text;
