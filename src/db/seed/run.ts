#!/usr/bin/env tsx
/**
 * 知識ツリー seed を Neon に流し込む CLI (idempotent)。
 *   pnpm db:seed
 *
 * YAML をパース → Zod で検証 → concepts テーブルへ upsert。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sql } from "drizzle-orm";
import { parse as parseYaml } from "yaml";

import { getDb } from "@/db/client";
import { concepts } from "@/db/schema";

import { toConceptRow } from "./build-rows";
import { SeedFileSchema } from "./schema";

async function main() {
  const file = resolve(process.cwd(), "src/db/seed/concepts.yaml");
  const raw = readFileSync(file, "utf8");
  const parsed = SeedFileSchema.parse(parseYaml(raw));

  // 内部整合性チェック: prereqs に存在しない id を書いていたら即落とす
  const knownIds = new Set(parsed.concepts.map((c) => c.id));
  for (const c of parsed.concepts) {
    for (const p of c.prereqs) {
      if (!knownIds.has(p)) {
        throw new Error(`concept "${c.id}" の prereq "${p}" が YAML 内に存在しない`);
      }
    }
  }

  const rows = parsed.concepts.map(toConceptRow);
  const db = getDb();
  const inserted = await db
    .insert(concepts)
    .values(rows)
    .onConflictDoUpdate({
      target: concepts.id,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        domainId: sql`excluded.domain_id`,
        subdomainId: sql`excluded.subdomain_id`,
        prereqs: sql`excluded.prereqs`,
        tags: sql`excluded.tags`,
        difficultyLevels: sql`excluded.difficulty_levels`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: concepts.id });

  console.log(`✓ seeded ${inserted.length} concepts`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
