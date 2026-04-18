import type { NewConcept } from "@/db/schema";

import type { SeedConcept } from "./schema";

/** YAML 由来の seed を concepts テーブルの insert/upsert 用に整形する */
export function toConceptRow(seed: SeedConcept): NewConcept {
  return {
    id: seed.id,
    domainId: seed.domain,
    subdomainId: seed.subdomain ?? null,
    name: seed.name,
    description: seed.description ?? null,
    prereqs: seed.prereqs,
    tags: seed.tags,
    difficultyLevels: seed.difficulty_levels,
    // created_at / updated_at は DB デフォルト
  };
}
