import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { User } from "@/db/schema";

import { appRouter } from "./index";

// 実際の LLM 呼び出しをスタブして境界 (zod input validation) の挙動だけを検査する。
vi.mock("@/server/parser/custom-session", async () => {
  const actual = await vi.importActual<typeof import("@/server/parser/custom-session")>(
    "@/server/parser/custom-session",
  );
  return {
    ...actual,
    parseCustomSession: vi.fn(async (raw: string) => ({
      spec: {
        questionCount: 5,
        difficulty: { kind: "absolute" as const, level: "junior" as const },
      },
      promptVersion: "custom-session.v1",
      model: "gpt-5-mini",
      echo: raw,
    })),
  };
});

describe("custom.parse input validation (router 境界テスト)", () => {
  const fakeUser = { id: "u-1" } as User;
  const caller = appRouter.createCaller({ user: fakeUser });

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("空文字は reject (whitespace-only を含む)", async () => {
    await expect(caller.custom.parse({ raw: "" })).rejects.toThrow();
    await expect(caller.custom.parse({ raw: "   " })).rejects.toThrow();
    await expect(caller.custom.parse({ raw: "\n\t " })).rejects.toThrow();
  });

  it("trim 後 2000 文字 + 末尾空白は accept (max が trim 前に効く回帰を捕捉)", async () => {
    // max が transform(trim) 後に適用される順序保証のためのガード。
    // Round 2 の .max(2000).transform(trim) 実装では length=2001 扱いで reject してしまう。
    const padded = `${"x".repeat(2000)} `;
    await expect(caller.custom.parse({ raw: padded })).resolves.toHaveProperty("spec");
  });

  it("trim 後 2001 文字は reject", async () => {
    await expect(caller.custom.parse({ raw: `${"x".repeat(2001)} ` })).rejects.toThrow();
  });

  it("未認証 (user: null) は UNAUTHORIZED", async () => {
    const anon = appRouter.createCaller({ user: null });
    await expect(anon.custom.parse({ raw: "hello" })).rejects.toThrow();
  });
});
