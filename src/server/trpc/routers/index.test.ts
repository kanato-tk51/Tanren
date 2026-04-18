import { describe, it, expect } from "vitest";

import { appRouter } from "./index";

describe("appRouter.ping", () => {
  it("引数なしで呼ぶと pong を返す", async () => {
    const caller = appRouter.createCaller({ user: null });
    await expect(caller.ping()).resolves.toEqual({ message: "pong" });
  });

  it("name を渡すと pong: <name> を返す", async () => {
    const caller = appRouter.createCaller({ user: null });
    await expect(caller.ping({ name: "tanren" })).resolves.toEqual({
      message: "pong: tanren",
    });
  });

  it("name が空文字なら Zod バリデーションで弾かれる", async () => {
    const caller = appRouter.createCaller({ user: null });
    await expect(caller.ping({ name: "" })).rejects.toThrow();
  });

  it("name が 50 文字超なら Zod バリデーションで弾かれる", async () => {
    const caller = appRouter.createCaller({ user: null });
    await expect(caller.ping({ name: "x".repeat(51) })).rejects.toThrow();
  });
});
