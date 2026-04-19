import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/db/schema";

import { appRouter } from "./index";
import { __resetRateLimitForTest } from "./code";

vi.mock("@/lib/judge0/client", () => {
  return {
    executeCode: vi.fn(async () => ({
      stdout: "hello\n",
      stderr: "",
      status: "Accepted",
      timeSec: 0.01,
      memoryKb: 3096,
      token: "tok",
    })),
    JUDGE0_MAX_SOURCE_BYTES: 10 * 1024,
    Judge0DisabledError: class Judge0DisabledError extends Error {
      constructor() {
        super("disabled");
        this.name = "Judge0DisabledError";
      }
    },
    Judge0RequestError: class Judge0RequestError extends Error {
      constructor(
        m: string,
        public readonly statusCode?: number,
      ) {
        super(m);
        this.name = "Judge0RequestError";
      }
    },
  };
});

const fakeUser = { id: "u-1" } as User;

beforeEach(() => {
  __resetRateLimitForTest();
});
afterEach(() => vi.clearAllMocks());

describe("code.execute (issue #34)", () => {
  const caller = appRouter.createCaller({ user: fakeUser });

  it("対応外の language は reject", async () => {
    await expect(caller.code.execute({ language: "cobol", source: "print(1)" })).rejects.toThrow();
  });

  it("source 空は reject (min 1)", async () => {
    await expect(caller.code.execute({ language: "python", source: "" })).rejects.toThrow();
  });

  it("未認証 (user=null) は UNAUTHORIZED", async () => {
    const anon = appRouter.createCaller({ user: null });
    await expect(anon.code.execute({ language: "python", source: "print(1)" })).rejects.toThrow();
  });

  it("正常系: Judge0 の結果をそのまま返す", async () => {
    const out = await caller.code.execute({ language: "python", source: "print('hello')" });
    expect(out.stdout).toBe("hello\n");
    expect(out.status).toBe("Accepted");
  });

  it("rate limit: 31 回目は TOO_MANY_REQUESTS", async () => {
    for (let i = 0; i < 30; i++) {
      await caller.code.execute({ language: "python", source: "print(1)" });
    }
    await expect(caller.code.execute({ language: "python", source: "print(1)" })).rejects.toThrow(
      /rate limit/,
    );
  });
});
