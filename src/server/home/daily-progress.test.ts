import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchDailyProgress } from "./daily-progress";

const queue: Array<() => unknown> = [];
vi.mock("@/db/client", () => {
  function makeBuilder(): unknown {
    const b: Record<string, unknown> = {
      from: () => b,
      where: () => b,
      then: (onFulfilled: (v: unknown) => unknown) => {
        const handler = queue.shift();
        const result = handler ? handler() : [];
        return Promise.resolve(result).then(onFulfilled);
      },
    };
    return b;
  }
  return { getDb: () => ({ select: () => makeBuilder() }) };
});

beforeEach(() => {
  queue.length = 0;
});

describe("fetchDailyProgress", () => {
  it("count クエリ結果を attemptCount に反映する", async () => {
    queue.push(() => [{ count: 7 }]);
    const res = await fetchDailyProgress({ userId: "user-1" });
    expect(res.attemptCount).toBe(7);
  });

  it("0 件は 0 を返す (空配列でも null でも安全)", async () => {
    queue.push(() => []);
    const res = await fetchDailyProgress({ userId: "user-1" });
    expect(res.attemptCount).toBe(0);
  });
});
