import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { DifficultyLevel, DomainId } from "./_constants";

export const concepts = pgTable(
  "concepts",
  {
    /** 'network.tcp.congestion' のような snake_case ドット区切り */
    id: text("id").primaryKey(),
    domainId: text("domain_id").$type<DomainId>().notNull(),
    // 3 階層 (domain.subdomain.concept) 固定ルール (docs/02-learning-system.md §2.1)。
    // 複数経路から null が入らないよう DB 側でも NOT NULL
    subdomainId: text("subdomain_id").notNull(),
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
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_concepts_domain").on(table.domainId),
    index("idx_concepts_tags").using("gin", table.tags),
    // difficulty_levels は 1 件以上を DB 側でも強制 (Zod/YAML と三重整合)
    check(
      "concepts_difficulty_levels_nonempty_chk",
      sql`jsonb_typeof(${table.difficultyLevels}) = 'array' AND jsonb_array_length(${table.difficultyLevels}) >= 1`,
    ),
  ],
);

export type Concept = typeof concepts.$inferSelect;
export type NewConcept = typeof concepts.$inferInsert;
