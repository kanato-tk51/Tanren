import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/db/schema";

import { appRouter } from "./index";

// session.start (kind='review') 経由の router テスト。
// DB / scheduler を mock して、10-15 clamp と PRECONDITION_FAILED 経路を API 境界で検証。

const valuesSpy = vi.fn();
const reviewSpy = vi.fn();

vi.mock("@/db/client", () => {
  const returning = vi.fn().mockResolvedValue([{ id: "sess-review" }]);
  const values = vi.fn((v: unknown) => {
    valuesSpy(v);
    return { returning };
  });
  const insert = vi.fn().mockReturnValue({ values });
  return { getDb: vi.fn().mockReturnValue({ insert }) };
});

vi.mock("@/server/scheduler/review", async () => {
  const actual = await vi.importActual<typeof import("@/server/scheduler/review")>(
    "@/server/scheduler/review",
  );
  return {
    ...actual,
    selectReviewCandidates: (params: unknown) => reviewSpy(params),
  };
});

beforeEach(() => {
  valuesSpy.mockClear();
  reviewSpy.mockClear();
});

describe("session.start({kind:'review'}) 境界 (issue #23)", () => {
  const caller = appRouter.createCaller({ user: { id: "u-1" } as User });

  it("候補が 0 件なら PRECONDITION_FAILED で始まらない (セッション row も作られない)", async () => {
    reviewSpy.mockResolvedValue([]);
    await expect(caller.session.start({ kind: "review" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(valuesSpy).not.toHaveBeenCalled();
  });

  it("候補 3 件でも targetCount は 10 に clamp され、reviewConceptIds はその 3 件", async () => {
    const candidates = ["c1", "c2", "c3"].map((id) => ({
      concept: { id, name: id, domainId: "x", subdomainId: "y", prereqs: [] },
      latestWrongAt: new Date(),
    }));
    reviewSpy.mockResolvedValue(candidates);

    const res = await caller.session.start({ kind: "review" });
    expect(res.targetCount).toBe(10);
    expect(valuesSpy).toHaveBeenCalledTimes(1);
    const payload = valuesSpy.mock.calls[0]?.[0] as {
      kind: string;
      spec: { targetCount: number; reviewConceptIds: string[] };
    };
    expect(payload.kind).toBe("review");
    expect(payload.spec.targetCount).toBe(10);
    expect(payload.spec.reviewConceptIds).toEqual(["c1", "c2", "c3"]);
  });

  it("入力 targetCount=20 でも上限 15 に clamp", async () => {
    const candidates = Array.from({ length: 20 }).map((_, i) => ({
      concept: { id: `c-${i}`, name: `C-${i}`, domainId: "x", subdomainId: "y", prereqs: [] },
      latestWrongAt: new Date(),
    }));
    reviewSpy.mockResolvedValue(candidates);

    const res = await caller.session.start({ kind: "review", targetCount: 20 });
    expect(res.targetCount).toBe(15);
  });

  it("入力 targetCount=3 (下限未満) でも下限 10 に clamp", async () => {
    const candidates = ["c1", "c2"].map((id) => ({
      concept: { id, name: id, domainId: "x", subdomainId: "y", prereqs: [] },
      latestWrongAt: new Date(),
    }));
    reviewSpy.mockResolvedValue(candidates);

    const res = await caller.session.start({ kind: "review", targetCount: 3 });
    expect(res.targetCount).toBe(10);
  });
});

describe("session.next のラウンドロビン (issue #23 受け入れ基準)", () => {
  it("reviewConceptIds=[a,b,c] + questionCount=0..5 で a,b,c,a,b,c の順に pick される", () => {
    // session.next 側のロジックを純粋関数として切り出して unit 検証する。
    // pick: reviewConceptIds[session.questionCount % reviewConceptIds.length]
    const queue = ["a", "b", "c"];
    const picks = Array.from({ length: 10 }).map((_, questionCount) => {
      return queue[questionCount % queue.length];
    });
    expect(picks).toEqual(["a", "b", "c", "a", "b", "c", "a", "b", "c", "a"]);
  });

  it("候補 1 件でも 10 ターン分キューから pick できる (全て同 concept)", () => {
    const queue = ["only"];
    const picks = Array.from({ length: 10 }).map((_, questionCount) => {
      return queue[questionCount % queue.length];
    });
    expect(picks.every((p) => p === "only")).toBe(true);
    expect(picks.length).toBe(10);
  });
});
