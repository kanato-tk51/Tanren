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

  // orphan 検出: DB にあるが YAML 側から消えた concept を警告する。
  // 自動削除は questions / attempts / mastery への FK があり cascade 削除が重いため、
  // 人間の判断で (1) YAML を元に戻す (2) 手動で archive / retire するのどちらかに委ねる。
  const existingIds = await db.select({ id: concepts.id }).from(concepts);
  const seededIds = new Set(knownIds);
  const orphans = existingIds
    .map((row) => row.id)
    .filter((id) => !seededIds.has(id))
    .sort();
  if (orphans.length > 0) {
    console.warn(
      `⚠ ${orphans.length} concept(s) in DB but not in concepts.yaml (drift)\n  ${orphans.join("\n  ")}\n  → manually review: restore in YAML, or retire/archive explicitly.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
