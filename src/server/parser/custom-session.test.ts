import { describe, it, expect, vi } from "vitest";

import { buildCustomSessionPrompt, parseCustomSession } from "./custom-session";
import { CustomSessionSpecSchema, CUSTOM_SESSION_JSON_SCHEMA } from "./schema";

describe("buildCustomSessionPrompt", () => {
  it("Rules が user 冒頭、User request が末尾 (prompt caching 規約)", () => {
    const out = buildCustomSessionPrompt("TCP の輻輳制御を senior で 5 問");
    expect(out.user.indexOf("## Rules")).toBeLessThan(out.user.indexOf("## User request"));
    expect(out.user).toContain("TCP の輻輳制御を senior で 5 問");
  });

  it("利用可能な domains/thinking_styles/question_types/difficulty を user 内に埋め込む", () => {
    const out = buildCustomSessionPrompt("何でもいい");
    expect(out.user).toContain("programming");
    expect(out.user).toContain("network");
    expect(out.user).toContain("trade_off");
    expect(out.user).toContain("senior");
  });

  it("system は厳密な parser 指示を含む", () => {
    const out = buildCustomSessionPrompt("X");
    expect(out.system).toContain("CustomSessionSpec");
  });

  it("snapshot (代表入力)", () => {
    const out = buildCustomSessionPrompt(
      "面接レベルで、TCP の輻輳制御について 5 問、なぜそうなっているかを問う",
    );
    expect({ system: out.system, user: out.user }).toMatchSnapshot();
  });
});

describe("CustomSessionSpecSchema", () => {
  it("最小形 (questionCount + difficulty のみ。他は omit)", () => {
    const spec = CustomSessionSpecSchema.parse({
      questionCount: 5,
      difficulty: { kind: "absolute", level: "junior" },
    });
    expect(spec.questionCount).toBe(5);
    expect(spec.thinkingStyles).toBeUndefined();
    expect(spec.updateMastery).toBeUndefined();
  });

  it("questionCount 0 は reject", () => {
    expect(() =>
      CustomSessionSpecSchema.parse({
        questionCount: 0,
        difficulty: { kind: "absolute", level: "junior" },
      }),
    ).toThrow();
  });

  it("未知の thinkingStyle は reject", () => {
    expect(() =>
      CustomSessionSpecSchema.parse({
        thinkingStyles: ["unknown_style"],
      }),
    ).toThrow();
  });

  it("空配列 (thinkingStyles: []) は reject (omit が正)", () => {
    expect(() =>
      CustomSessionSpecSchema.parse({
        questionCount: 5,
        thinkingStyles: [],
      }),
    ).toThrow();
  });

  it("SCHEMA は strict + additionalProperties: false", () => {
    expect(CUSTOM_SESSION_JSON_SCHEMA.strict).toBe(true);
    expect(CUSTOM_SESSION_JSON_SCHEMA.schema.additionalProperties).toBe(false);
  });
});

describe("parseCustomSession (LLM DI)", () => {
  it("面接レベル → senior + trade_off/edge_case", async () => {
    const caller = vi.fn().mockResolvedValue({
      questionCount: 5,
      thinkingStyles: ["trade_off", "edge_case"],
      difficulty: { kind: "absolute", level: "senior" },
    });
    const { spec } = await parseCustomSession("面接レベル 5 問", caller);
    expect(spec.difficulty?.level).toBe("senior");
    expect(spec.thinkingStyles).toContain("trade_off");
  });

  it("LLM が不正 JSON (未知 style) を返したら Zod 例外を投げる", async () => {
    const caller = vi.fn().mockResolvedValue({
      questionCount: 5,
      thinkingStyles: ["imagination"],
    });
    await expect(parseCustomSession("X", caller)).rejects.toThrow();
  });

  it("基礎 → junior + thinkingStyles omit", async () => {
    const caller = vi.fn().mockResolvedValue({
      questionCount: 3,
      difficulty: { kind: "absolute", level: "junior" },
    });
    const { spec } = await parseCustomSession("Python の基礎を 3 問", caller);
    expect(spec.difficulty?.level).toBe("junior");
    expect(spec.thinkingStyles).toBeUndefined();
    expect(spec.questionCount).toBe(3);
  });

  it("constraints.mustInclude が保持される", async () => {
    const caller = vi.fn().mockResolvedValue({
      questionCount: 2,
      difficulty: { kind: "absolute", level: "mid" },
      constraints: { mustInclude: ["TLS 1.3"] },
    });
    const { spec } = await parseCustomSession("TLS 1.3 を必ず含めて", caller);
    expect(spec.constraints?.mustInclude).toEqual(["TLS 1.3"]);
  });

  it("ドメイン指定が伝わる (network)", async () => {
    const caller = vi.fn().mockResolvedValue({
      questionCount: 5,
      difficulty: { kind: "absolute", level: "junior" },
      domains: ["network"],
    });
    const { spec } = await parseCustomSession("network 5 問", caller);
    expect(spec.domains).toEqual(["network"]);
  });

  it("Zod strict: 未知フィールドは reject (JSON schema additionalProperties:false と一致)", async () => {
    const caller = vi.fn().mockResolvedValue({
      questionCount: 5,
      unknownField: "x",
    });
    await expect(parseCustomSession("x", caller)).rejects.toThrow();
  });

  it("未指定フィールドは omit (受け入れ基準 4): 最小形は questionCount だけ", async () => {
    const caller = vi.fn().mockResolvedValue({ questionCount: 3 });
    const { spec } = await parseCustomSession("3 問出して", caller);
    expect(spec.questionCount).toBe(3);
    expect(spec.difficulty).toBeUndefined();
    expect(spec.thinkingStyles).toBeUndefined();
    expect(spec.updateMastery).toBeUndefined();
  });
});

describe("parseCustomSession snapshots (受け入れ基準: 5 本)", () => {
  const cases: Array<{ name: string; llmJson: Record<string, unknown> }> = [
    {
      name: "面接レベル (senior + trade_off/edge_case)",
      llmJson: {
        questionCount: 5,
        thinkingStyles: ["trade_off", "edge_case"],
        difficulty: { kind: "absolute", level: "senior" },
      },
    },
    {
      name: "基礎 (junior + thinkingStyles omit)",
      llmJson: {
        questionCount: 3,
        difficulty: { kind: "absolute", level: "junior" },
      },
    },
    {
      name: "constraints.mustInclude (TLS 1.3)",
      llmJson: {
        questionCount: 2,
        difficulty: { kind: "absolute", level: "mid" },
        constraints: { mustInclude: ["TLS 1.3"] },
      },
    },
    {
      name: "ドメイン指定 + 実務的 (apply)",
      llmJson: {
        questionCount: 5,
        domains: ["network"],
        thinkingStyles: ["apply"],
        difficulty: { kind: "absolute", level: "mid" },
      },
    },
    {
      name: "staff レベル (MVP 6 段階)",
      llmJson: {
        questionCount: 3,
        difficulty: { kind: "absolute", level: "staff" },
        thinkingStyles: ["trade_off"],
      },
    },
    {
      name: "未指定 omit の最小形 (questionCount だけ)",
      llmJson: { questionCount: 1 },
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const caller = vi.fn().mockResolvedValue(c.llmJson);
      const { spec, promptVersion, model } = await parseCustomSession("raw", caller);
      expect({ spec, promptVersion, model }).toMatchSnapshot();
    });
  }
});
