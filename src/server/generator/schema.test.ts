import { describe, it, expect } from "vitest";

import { GeneratedMcqSchema, MCQ_JSON_SCHEMA } from "./schema";

describe("GeneratedMcqSchema", () => {
  it("正常系 JSON を受理", () => {
    const ok = {
      prompt: "HTTP の PUT と PATCH の違いは?",
      answer: "PUT は冪等、PATCH は部分更新",
      distractors: [
        "PUT は常に新規作成、PATCH は既存更新",
        "PUT はキャッシュされる、PATCH はされない",
        "PUT は body 不要、PATCH は必須",
      ],
      explanation: "PUT は同じ結果を何度呼んでも同じ状態にする冪等性を保証する。",
      hint: null,
      tags: ["rest", "idempotency"],
    };
    expect(() => GeneratedMcqSchema.parse(ok)).not.toThrow();
  });

  it("distractors が 3 件以外なら reject", () => {
    const bad = {
      prompt: "x",
      answer: "y",
      distractors: ["a", "b"], // 2 件のみ
      explanation: "z",
      hint: null,
      tags: ["t"],
    };
    expect(() => GeneratedMcqSchema.parse(bad)).toThrow();
  });

  it("MCQ_JSON_SCHEMA は strict=true で additionalProperties:false", () => {
    expect(MCQ_JSON_SCHEMA.strict).toBe(true);
    expect(MCQ_JSON_SCHEMA.schema.additionalProperties).toBe(false);
    expect(MCQ_JSON_SCHEMA.schema.required).toContain("hint");
  });
});
