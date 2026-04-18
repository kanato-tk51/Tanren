import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()::text`),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  timezone: text("timezone").default("Asia/Tokyo"),
  dailyGoal: integer("daily_goal").notNull().default(15),
  /** 'HH:mm' 形式 */
  notificationTime: text("notification_time"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
