import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/db/schema";

import { appRouter } from "./index";

// DB クライアントをスタブ。session.start は insert().values().returning() をチェーンで呼ぶ。
// loadConcept は select().from().where().limit() を呼ぶ。
// テスト間で「次に返す concept」を差し替えるために nextConceptRow を module スコープで保持。
const valuesSpy = vi.fn();
let nextConceptRow: { id: string; difficultyLevels: string[] } | null = null;
vi.mock("@/db/client", () => {
  const returning = vi.fn().mockResolvedValue([{ id: "sess-fake" }]);
  const values = vi.fn((v: unknown) => {
    valuesSpy(v);
    return { returning };
  });
  const insert = vi.fn().mockReturnValue({ values });
  const limit = vi.fn(async () => (nextConceptRow ? [nextConceptRow] : []));
  const whereFn = vi.fn(() => ({ limit }));
  const fromFn = vi.fn(() => ({ where: whereFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));
  return {
    getDb: vi.fn().mockReturnValue({ insert, select: selectFn }),
  };
});

beforeEach(() => {
  valuesSpy.mockClear();
  nextConceptRow = null;
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

  it("difficulty=staff / principal も受け入れる (Round 10: 6 段階統一)", async () => {
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: { questionCount: 3, difficulty: { kind: "absolute", level: "staff" } },
      }),
    ).resolves.toHaveProperty("sessionId");
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: { questionCount: 3, difficulty: { kind: "absolute", level: "principal" } },
      }),
    ).resolves.toHaveProperty("sessionId");
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

  it("concepts[0] と difficulty が不整合なら start 時点で BAD_REQUEST (Round 9 #1)", async () => {
    nextConceptRow = {
      id: "programming.basics.value_vs_reference",
      difficultyLevels: ["beginner", "junior"],
    };
    await expect(
      caller.session.start({
        kind: "custom",
        customSpec: {
          questionCount: 3,
          difficulty: { kind: "absolute", level: "senior" },
          concepts: ["programming.basics.value_vs_reference"],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("concepts[0] と difficulty が整合する場合は accept", async () => {
    nextConceptRow = {
      id: "db.rdb.btree_index",
      difficultyLevels: ["junior", "mid", "senior"],
    };
    const res = await caller.session.start({
      kind: "custom",
      customSpec: {
        questionCount: 3,
        difficulty: { kind: "absolute", level: "senior" },
        concepts: ["db.rdb.btree_index"],
      },
    });
    expect(res.sessionId).toBe("sess-fake");
  });

  it("正ケース: accept → insert payload に customSpec / kind='custom' / userId が積まれる", async () => {
    nextConceptRow = {
      id: "network.tcp.basics",
      difficultyLevels: ["beginner", "junior", "mid"],
    };
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
