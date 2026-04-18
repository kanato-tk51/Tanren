import { z } from "zod";

export const GeneratedShortWrittenSchema = z.object({
  prompt: z.string().min(1),
  answer: z.string().min(1),
  rubric: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1),
        weight: z.number().min(0).max(1),
      }),
    )
    .min(2),
  hint: z.string().nullable(),
  explanation: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1).max(4),
});

export type GeneratedShortWritten = z.infer<typeof GeneratedShortWrittenSchema>;

export const SHORT_WRITTEN_JSON_SCHEMA = {
  name: "short_or_written_question",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["prompt", "answer", "rubric", "hint", "explanation", "tags"],
    properties: {
      prompt: { type: "string" },
      answer: { type: "string" },
      rubric: {
        type: "array",
        minItems: 2,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "description", "weight"],
          properties: {
            id: { type: "string" },
            description: { type: "string" },
            weight: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      hint: { type: ["string", "null"] },
      explanation: { type: "string" },
      tags: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 4,
      },
    },
  },
};
