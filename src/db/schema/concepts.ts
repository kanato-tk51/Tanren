import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { DifficultyLevel, DomainId } from "./_constants";

export const concepts = pgTable(
  "concepts",
  {
    /** 'network.tcp.congestion' のような snake_case ドット区切り */
    id: text("id").primaryKey(),
    domainId: text("domain_id").$type<DomainId>().notNull(),
    subdomainId: text("subdomain_id"),
    name: text("name").notNull(),
    description: text("description"),
    prereqs: jsonb("prereqs")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`),
    tags: jsonb("tags")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`),
    difficultyLevels: jsonb("difficulty_levels")
      .$type<DifficultyLevel[]>()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_concepts_domain").on(table.domainId),
    index("idx_concepts_tags").using("gin", table.tags),
  ],
);

export type Concept = typeof concepts.$inferSelect;
export type NewConcept = typeof concepts.$inferInsert;
