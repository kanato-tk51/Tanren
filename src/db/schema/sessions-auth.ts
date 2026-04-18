import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { users } from "./users";

/** 認証セッション (cookie)。学習の sessions テーブルとは別物 */
export const sessionsAuth = pgTable(
  "sessions_auth",
  {
    /** `crypto.randomUUID()` 由来の cookie 値 */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_sessions_auth_user").on(table.userId),
    index("idx_sessions_auth_expires").on(table.expiresAt),
  ],
);

export type SessionAuth = typeof sessionsAuth.$inferSelect;
export type NewSessionAuth = typeof sessionsAuth.$inferInsert;
