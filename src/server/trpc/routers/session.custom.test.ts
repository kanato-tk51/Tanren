import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import type { User } from "@/db/schema";

import { appRouter } from "./index";

describe("session.start with customSpec validation", () => {
  const fakeUser = { id: "u-1" } as User;
  const caller = appRouter.createCaller({ user: fakeUser });

  it("kind='custom' なのに customSpec が無ければ BAD_REQUEST", async () => {
    await expect(caller.session.start({ kind: "custom" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("kind='daily' なのに customSpec が付いていたら BAD_REQUEST", async () => {
    // 本来の型定義上は問題ない optional の同時指定。実装側で kind と customSpec の
    // 整合をチェックしているため、その境界動作を verify する。
    await expect(
      caller.session.start({
        kind: "daily",
        customSpec: {
          questionCount: 3,
          difficulty: { kind: "absolute", level: "junior" },
        },
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("MVP 未対応: difficulty=staff / principal は BAD_REQUEST", async () => {
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: { questionCount: 3, difficulty: { kind: "absolute", level: "staff" } },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: { questionCount: 3, difficulty: { kind: "absolute", level: "principal" } },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("MVP 未対応: questionTypes に mcq が含まれないと BAD_REQUEST", async () => {
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: {
          questionCount: 3,
          difficulty: { kind: "absolute", level: "junior" },
          questionTypes: ["written"],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("MVP 未対応: constraints の実効フィールドがあれば BAD_REQUEST", async () => {
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: {
          questionCount: 3,
          difficulty: { kind: "absolute", level: "junior" },
          constraints: { mustInclude: ["TLS 1.3"] },
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
