import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { WebauthnChallengePurpose } from "./_constants";
import { users } from "./users";

export const webauthnChallenges = pgTable("webauthn_challenges", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  challenge: text("challenge").notNull(),
  purpose: text("purpose").$type<WebauthnChallengePurpose>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type WebauthnChallenge = typeof webauthnChallenges.$inferSelect;
export type NewWebauthnChallenge = typeof webauthnChallenges.$inferInsert;
