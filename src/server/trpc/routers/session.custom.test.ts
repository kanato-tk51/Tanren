import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import type { User } from "@/db/schema";

import { appRouter } from "./index";

// DB クライアントをスタブ。session.start は insert().values().returning() をチェーンで呼ぶ。
vi.mock("@/db/client", () => {
  const returning = vi.fn().mockResolvedValue([{ id: "sess-fake" }]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return {
    getDb: vi.fn().mockReturnValue({ insert }),
    __getDbMocks: { insert, values, returning },
  };
});

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

  it("MVP 未対応: questionTypes が mcq 以外を含むと BAD_REQUEST", async () => {
    // mcq 単体ケース
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
    // mcq と混在していても reject (Round 3 厳格化)
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: {
          questionCount: 3,
          difficulty: { kind: "absolute", level: "junior" },
          questionTypes: ["mcq", "written"],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // mcq 重複 (length !== 1) も reject (Round 4 厳格化)
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: {
          questionCount: 3,
          difficulty: { kind: "absolute", level: "junior" },
          questionTypes: ["mcq", "mcq"],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("MVP 未対応: domains / subdomains / excludeConcepts は BAD_REQUEST", async () => {
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: {
          questionCount: 3,
          difficulty: { kind: "absolute", level: "junior" },
          domains: ["network"],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: {
          questionCount: 3,
          difficulty: { kind: "absolute", level: "junior" },
          subdomains: ["network.tcp"],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: {
          questionCount: 3,
          difficulty: { kind: "absolute", level: "junior" },
          excludeConcepts: ["network.tcp.basics"],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("MVP 未対応: constraints.language も BAD_REQUEST", async () => {
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: {
          questionCount: 3,
          difficulty: { kind: "absolute", level: "junior" },
          constraints: { language: "en" },
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("MVP 未対応: thinkingStyles 2 件以上は BAD_REQUEST", async () => {
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: {
          questionCount: 3,
          difficulty: { kind: "absolute", level: "junior" },
          thinkingStyles: ["trade_off", "edge_case"],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("MVP 未対応: concepts 2 件以上は BAD_REQUEST", async () => {
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: {
          questionCount: 3,
          difficulty: { kind: "absolute", level: "junior" },
          concepts: ["network.tcp.basics", "network.tcp.congestion"],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("正ケース: questionTypes=['mcq'] / thinkingStyles=[one] / concepts=[one] は全て accept し DB insert へ到達", async () => {
    // 入力バリデーションを全て通過すると getDb().insert(sessions).values().returning() が呼ばれる。
    // 返り値はモック で { id: 'sess-fake' }。
    const res = await caller.session.start({
      kind: "custom",
      customSpec: {
        questionCount: 3,
        difficulty: { kind: "absolute", level: "junior" },
        questionTypes: ["mcq"],
        thinkingStyles: ["trade_off"],
        concepts: ["network.tcp.basics"],
      },
    });
    expect(res.sessionId).toBe("sess-fake");
    expect(res.targetCount).toBe(3);
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
