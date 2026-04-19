import { sql } from "drizzle-orm";
import { bigint, boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { DifficultyLevel, DomainId } from "./_constants";

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()::text`),
  /** GitHub OAuth 移行 (ADR-0006) 後は email は任意。旧 Passkey 時代の行は保持される */
  email: text("email").unique(),
  displayName: text("display_name"),
  /** GitHub user id (stable、login 変更に影響されない)。allowlist 照合と紐付けの主キー */
  githubUserId: bigint("github_user_id", { mode: "number" }).unique(),
  /** 現在の GitHub login (UI 表示用、本人が GitHub 側で rename すると変わる) */
  githubLogin: text("github_login"),
  timezone: text("timezone").default("Asia/Tokyo"),
  dailyGoal: integer("daily_goal").notNull().default(15),
  /** 'HH:mm' 形式 */
  notificationTime: text("notification_time"),
  /** 初回オンボーディング (issue #26) 完了時刻。null なら /onboarding にリダイレクト */
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  /** オンボーディングで選んだ興味分野 (Tier 1 6 ドメイン中の subset) */
  interestDomains: jsonb("interest_domains")
    .$type<DomainId[]>()
    .default(sql`'[]'::jsonb`),
  /** オンボーディングでの自己申告レベル */
  selfLevel: text("self_level").$type<DifficultyLevel>(),
  /** Weekly Digest メール (issue #36) の送信を受け取るか。デフォルト true (opt-out 方式) */
  weeklyDigestEnabled: boolean("weekly_digest_enabled").notNull().default(true),
  /** Web Push (issue #37) を使うか。デフォルト false (opt-in)。
   *  ブラウザ側で Notification.requestPermission() + subscription 作成してから ON にする想定。 */
  webPushEnabled: boolean("web_push_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
