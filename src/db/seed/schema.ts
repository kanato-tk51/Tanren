import { z } from "zod";

import { DIFFICULTY_LEVELS, DOMAIN_IDS } from "@/db/schema";

/** `src/db/seed/concepts.yaml` のスキーマ (Zod) */
export const SeedConceptSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/,
        "id は domain.subdomain.name の snake_case ドット区切りで統一する",
      ),
    name: z.string().min(1),
    description: z.string().optional(),
    domain: z.enum(DOMAIN_IDS),
    // docs/02-learning-system.md §2.1.4: id は必ず domain.subdomain.name の 3 階層
    subdomain: z.string().min(1),
    prereqs: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    // 1 つ以上必須: 難易度レベルが無いと問題生成・出題ができないため
    difficulty_levels: z.array(z.enum(DIFFICULTY_LEVELS)).min(1),
  })
  .superRefine((value, ctx) => {
    // id の第 1/第 2 セグメントが domain/subdomain と整合しているかを強制。
    // docs/02-learning-system.md §2.1.4 に従い 3 階層 (domain.subdomain.name) は一致必須。
    const [domainFromId, subdomainFromId] = value.id.split(".");
    if (domainFromId !== value.domain) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: `id の domain prefix "${domainFromId}" が domain フィールド "${value.domain}" と一致しない`,
      });
    }
    if (subdomainFromId !== value.subdomain) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: `id の subdomain prefix "${subdomainFromId}" が subdomain フィールド "${value.subdomain}" と一致しない`,
      });
    }
  });

export type SeedConcept = z.infer<typeof SeedConceptSchema>;

export const SeedFileSchema = z.object({
  concepts: z.array(SeedConceptSchema),
});
