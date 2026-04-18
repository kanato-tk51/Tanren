import { z } from "zod";

export const GradedShortSchema = z.object({
  score: z.number().min(0).max(1),
  correct: z.boolean(),
  feedback: z.string().min(1),
  rubricChecks: z
    .array(
      z.object({
        id: z.string().min(1),
        passed: z.boolean(),
        comment: z.string(),
      }),
    )
    .default([]),
});

export type GradedShort = z.infer<typeof GradedShortSchema>;

export const SHORT_JSON_SCHEMA = {
  name: "short_grading",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["score", "correct", "feedback", "rubricChecks"],
    properties: {
      score: { type: "number", minimum: 0, maximum: 1 },
      correct: { type: "boolean" },
      feedback: { type: "string" },
      rubricChecks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "passed", "comment"],
          properties: {
            id: { type: "string" },
            passed: { type: "boolean" },
            comment: { type: "string" },
          },
        },
      },
    },
  },
};
