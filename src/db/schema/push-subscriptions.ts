import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { users } from "./users";

/** Web Push 購読情報 (issue #37, docs/07 §7.5.5)。
 *  1 user × 複数デバイス (endpoint 単位で unique)。
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Push Service の endpoint URL (unique) */
    endpoint: text("endpoint").notNull().unique(),
    /** 暗号化公開鍵 (base64url) */
    p256dh: text("p256dh").notNull(),
    /** 認証シークレット (base64url) */
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [index("idx_push_subscriptions_user").on(table.userId)],
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
