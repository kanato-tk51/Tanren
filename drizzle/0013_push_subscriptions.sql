-- issue #37: Web Push 購読情報を保存するテーブル
CREATE TABLE "push_subscriptions" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_success_at" timestamp with time zone,
  "last_error" text
);

CREATE INDEX "idx_push_subscriptions_user" ON "push_subscriptions" ("user_id");

-- users に Web Push on/off フラグ (opt-in 方式、デフォルト false)
ALTER TABLE "users"
  ADD COLUMN "web_push_enabled" boolean NOT NULL DEFAULT false;
