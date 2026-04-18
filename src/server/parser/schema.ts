import { z } from "zod";

import {
  DIFFICULTY_LEVELS,
  DOMAIN_IDS,
  QUESTION_TYPES,
  THINKING_STYLES,
} from "@/db/schema/_constants";

/**
 * CustomSessionSpec (docs/04 §4.3)。
 * MVP は `absolute` 難易度のみを実装し、relative / numeric / interview は Phase 5+。
 * thinking_styles / question_types / difficulty は実装 constants (_constants.ts) に合わせる。
 */
export const DifficultyAbsoluteSchema = z.object({
  kind: z.literal("absolute"),
  level: z.enum(DIFFICULTY_LEVELS),
});

export type DifficultySpec = z.infer<typeof DifficultyAbsoluteSchema>;

export const CustomSessionSpecSchema = z.object({
  domains: z.array(z.enum(DOMAIN_IDS)).optional(),
  subdomains: z.array(z.string().min(1)).optional(),
  concepts: z.array(z.string().min(1)).optional(),
  excludeConcepts: z.array(z.string().min(1)).optional(),
  thinkingStyles: z.array(z.enum(THINKING_STYLES)).default([]),
  questionTypes: z.array(z.enum(QUESTION_TYPES)).optional(),
  questionCount: z.number().int().min(1).max(20),
  difficulty: DifficultyAbsoluteSchema,
  constraints: z
    .object({
      language: z.enum(["ja", "en"]).optional(),
      codeLanguage: z.string().min(1).optional(),
      timeLimitSec: z.number().int().min(5).max(3600).optional(),
      mustInclude: z.array(z.string().min(1)).optional(),
      avoid: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  updateMastery: z.boolean().default(true),
});

export type CustomSessionSpec = z.infer<typeof CustomSessionSpecSchema>;

/**
 * OpenAI Structured Outputs 用の JSON schema。
 * - additionalProperties: false を明示 (strict: true で必須)
 * - optional は required から外す
 * - enum は 定数から直接埋め込む
 */
export const CUSTOM_SESSION_JSON_SCHEMA = {
  name: "custom_session_spec",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["thinkingStyles", "questionCount", "difficulty", "updateMastery"],
    properties: {
      domains: { type: "array", items: { type: "string", enum: [...DOMAIN_IDS] } },
      subdomains: { type: "array", items: { type: "string" } },
      concepts: { type: "array", items: { type: "string" } },
      excludeConcepts: { type: "array", items: { type: "string" } },
      thinkingStyles: { type: "array", items: { type: "string", enum: [...THINKING_STYLES] } },
      questionTypes: { type: "array", items: { type: "string", enum: [...QUESTION_TYPES] } },
      questionCount: { type: "integer", minimum: 1, maximum: 20 },
      difficulty: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "level"],
        properties: {
          kind: { type: "string", enum: ["absolute"] },
          level: { type: "string", enum: [...DIFFICULTY_LEVELS] },
        },
      },
      constraints: {
        type: "object",
        additionalProperties: false,
        properties: {
          language: { type: "string", enum: ["ja", "en"] },
          codeLanguage: { type: "string" },
          timeLimitSec: { type: "integer", minimum: 5, maximum: 3600 },
          mustInclude: { type: "array", items: { type: "string" } },
          avoid: { type: "array", items: { type: "string" } },
        },
      },
      updateMastery: { type: "boolean" },
    },
  },
};
