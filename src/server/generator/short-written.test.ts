import { describe, it, expect } from "vitest";

import { GeneratedShortWrittenSchema, SHORT_WRITTEN_JSON_SCHEMA } from "./short-written-schema";

describe("GeneratedShortWrittenSchema", () => {
  it("正常系 (rubric 2 項目以上)", () => {
    const ok = {
      prompt: "HTTP PUT と PATCH の違いを 2 文で。",
      answer: "PUT は冪等、PATCH は部分更新。",
      rubric: [
        { id: "r1", description: "PUT の冪等性に言及", weight: 0.5 },
        { id: "r2", description: "PATCH の部分更新に言及", weight: 0.5 },
      ],
      hint: null,
      explanation: "冪等性とは同じリクエストを何度送っても結果が同じになる性質。",
      tags: ["rest"],
    };
    expect(() => GeneratedShortWrittenSchema.parse(ok)).not.toThrow();
  });

  it("rubric 1 件なら reject", () => {
    const bad = {
      prompt: "x",
      answer: "y",
      rubric: [{ id: "r1", description: "d", weight: 1 }],
      hint: null,
      explanation: "z",
      tags: ["t"],
    };
    expect(() => GeneratedShortWrittenSchema.parse(bad)).toThrow();
  });

  it("JSON schema は strict + additionalProperties=false", () => {
    expect(SHORT_WRITTEN_JSON_SCHEMA.strict).toBe(true);
    expect(SHORT_WRITTEN_JSON_SCHEMA.schema.additionalProperties).toBe(false);
    expect(SHORT_WRITTEN_JSON_SCHEMA.schema.required).toContain("rubric");
  });
});
