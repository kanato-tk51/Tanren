import { z } from "zod";

/** OpenAI Structured Outputs で受け取る mcq JSON の形 */
export const GeneratedMcqSchema = z.object({
  prompt: z.string().min(1),
  answer: z.string().min(1),
  distractors: z.array(z.string().min(1)).length(3),
  explanation: z.string().min(1),
  hint: z.string().nullable(),
  tags: z.array(z.string().min(1)).min(1).max(4),
});

export type GeneratedMcq = z.infer<typeof GeneratedMcqSchema>;

/**
 * OpenAI Responses API に渡す JSON schema。Zod からの自動変換は SDK 側で対応しているが
 * Structured Outputs 仕様 (strict: true + additionalProperties: false) に合う形で書き下す。
 */
export const MCQ_JSON_SCHEMA = {
  name: "mcq_question",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["prompt", "answer", "distractors", "explanation", "hint", "tags"],
    properties: {
      prompt: { type: "string" },
      answer: { type: "string" },
      distractors: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
      },
      explanation: { type: "string" },
      hint: { type: ["string", "null"] },
      tags: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 4,
      },
    },
  },
};
