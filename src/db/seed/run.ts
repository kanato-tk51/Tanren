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
  // MVP では docs/OPEN_QUESTIONS.md Q11 の方針どおり「warn のみ」に留め、
  // 自動削除はしない (questions / attempts / mastery への FK があり cascade が重いため)。
  // 対応は人間の判断で (1) YAML に復元する (2) 依存テーブルを確認したうえで手動 DELETE する。
  const existingIds = await db.select({ id: concepts.id }).from(concepts);
  const seededIds = new Set(knownIds);
  const orphans = existingIds
    .map((row) => row.id)
    .filter((id) => !seededIds.has(id))
    .sort();
  if (orphans.length > 0) {
    console.warn(
      `⚠ ${orphans.length} concept(s) in DB but not in concepts.yaml (drift)\n  ${orphans.join("\n  ")}\n  → MVP では手動運用 (docs/OPEN_QUESTIONS.md Q11): YAML に復元するか、依存テーブルを確認したうえで手動 DELETE する`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
