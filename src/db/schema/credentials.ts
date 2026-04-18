import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { CredentialDeviceType } from "./_constants";
import { users } from "./users";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Uint8Array): Buffer {
    return Buffer.from(value);
  },
  fromDriver(value: Buffer): Uint8Array {
    return new Uint8Array(value);
  },
});

export const credentials = pgTable(
  "credentials",
  {
    /** base64url エンコード済み credentialId */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicKey: bytea("public_key").notNull(),
    /** WebAuthn signCount。十分な桁を確保するため bigint */
    counter: bigint("counter", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    deviceType: text("device_type").$type<CredentialDeviceType>(),
    backedUp: boolean("backed_up").notNull().default(false),
    transports: jsonb("transports")
      .$type<AuthenticatorTransportFuture[]>()
      .default(sql`'[]'::jsonb`),
    nickname: text("nickname"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [index("idx_credentials_user").on(table.userId)],
);

export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
