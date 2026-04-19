import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchDailyProgress, jstStartOfToday } from "./daily-progress";

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

describe("jstStartOfToday", () => {
  it("UTC の 14:59 (= JST 23:59) は同日 00:00 JST を指す", () => {
    const now = new Date("2026-04-19T14:59:00Z");
    expect(jstStartOfToday(now).toISOString()).toBe("2026-04-18T15:00:00.000Z");
  });

  it("UTC の 15:00 (= JST 00:00) は翌日 00:00 JST を指す", () => {
    const now = new Date("2026-04-19T15:00:00Z");
    expect(jstStartOfToday(now).toISOString()).toBe("2026-04-19T15:00:00.000Z");
  });
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
