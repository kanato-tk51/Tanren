import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/db/schema";

import { appRouter } from "./index";

// DB クライアントをスタブ。session.start は insert().values().returning() をチェーンで呼ぶ。
// 他のテストで session.next / submit の DB アクセスを検証するために capture できる形に。
const valuesSpy = vi.fn();
vi.mock("@/db/client", () => {
  const returning = vi.fn().mockResolvedValue([{ id: "sess-fake" }]);
  const values = vi.fn((v: unknown) => {
    valuesSpy(v);
    return { returning };
  });
  const insert = vi.fn().mockReturnValue({ values });
  return {
    getDb: vi.fn().mockReturnValue({ insert }),
  };
});

beforeEach(() => {
  valuesSpy.mockClear();
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

  it("正ケース: accept → insert payload に customSpec / kind='custom' / userId が積まれる", async () => {
    const inputSpec = {
      questionCount: 3,
      difficulty: { kind: "absolute" as const, level: "junior" as const },
      questionTypes: ["mcq" as const],
      thinkingStyles: ["trade_off" as const],
      concepts: ["network.tcp.basics"],
      updateMastery: false,
    };
    const res = await caller.session.start({ kind: "custom", customSpec: inputSpec });
    expect(res.sessionId).toBe("sess-fake");
    expect(res.targetCount).toBe(3);

    // values() payload の中身検証: userId / kind / spec.customSpec が正しく積まれている
    expect(valuesSpy).toHaveBeenCalledTimes(1);
    const payload = valuesSpy.mock.calls[0]?.[0] as {
      userId: string;
      kind: string;
      spec: { targetCount: number; pendingQuestionId: null; customSpec: typeof inputSpec };
    };
    expect(payload.userId).toBe("u-1");
    expect(payload.kind).toBe("custom");
    expect(payload.spec.targetCount).toBe(3);
    expect(payload.spec.pendingQuestionId).toBeNull();
    expect(payload.spec.customSpec).toEqual(inputSpec);
  });

  it("正ケース: kind='daily' (customSpec なし) は insert payload に customSpec を積まない", async () => {
    await caller.session.start({ kind: "daily", targetCount: 7 });
    expect(valuesSpy).toHaveBeenCalledTimes(1);
    const payload = valuesSpy.mock.calls[0]?.[0] as {
      kind: string;
      spec: { targetCount: number; customSpec?: unknown };
    };
    expect(payload.kind).toBe("daily");
    expect(payload.spec.targetCount).toBe(7);
    expect(payload.spec.customSpec).toBeUndefined();
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
