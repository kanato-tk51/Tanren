import { z } from "zod";

import { DIFFICULTY_LEVELS, DOMAIN_IDS } from "@/db/schema";

/** `src/db/seed/concepts.yaml` のスキーマ (Zod) */
export const SeedConceptSchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/,
      "id は domain.subdomain.name の snake_case ドット区切りで統一する",
    ),
  name: z.string().min(1),
  description: z.string().optional(),
  domain: z.enum(DOMAIN_IDS),
  subdomain: z.string().min(1).optional(),
  prereqs: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  difficulty_levels: z.array(z.enum(DIFFICULTY_LEVELS)).default([]),
});

export type SeedConcept = z.infer<typeof SeedConceptSchema>;

export const SeedFileSchema = z.object({
  concepts: z.array(SeedConceptSchema),
});
