import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchTrends } from "./trends";

const queue: Array<() => unknown> = [];
vi.mock("@/db/client", () => {
  function makeBuilder(): unknown {
    const b: Record<string, unknown> = {
      from: () => b,
      where: () => b,
      groupBy: () => b,
      orderBy: () => b,
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

describe("fetchTrends", () => {
  it("days を 7..90 に clamp (デフォルト 30)", async () => {
    queue.push(() => []);
    const out = await fetchTrends({ userId: "u-1" });
    expect(out.days).toBe(30);
    expect(out.points).toHaveLength(30);

    queue.push(() => []);
    const tiny = await fetchTrends({ userId: "u-1", days: 1 });
    expect(tiny.days).toBe(7); // 7 まで引き上げ

    queue.push(() => []);
    const huge = await fetchTrends({ userId: "u-1", days: 10000 });
    expect(huge.days).toBe(90); // 90 まで clamp
  });

  it("欠損日は 0 埋めされる (全 7 日分の points が揃う、JST)", async () => {
    const now = new Date("2026-04-18T05:00:00Z"); // JST 14:00 2026-04-18
    queue.push(() => [
      // 4/18 だけデータあり、他は欠損
      { date: "2026-04-18", attemptCount: 3, correctCount: 2, studyTimeMs: 120000 },
    ]);
    const out = await fetchTrends({ userId: "u-1", days: 7, now });
    expect(out.points).toHaveLength(7);
    // 降順にソートされず、days-1..0 の昇順で並ぶ: 先頭は 6 日前、末尾が今日
    const last = out.points.at(-1)!;
    expect(last.date).toBe("2026-04-18");
    expect(last.attemptCount).toBe(3);
    expect(last.accuracyPct).toBeCloseTo(2 / 3, 5);
    // 欠損日は全て 0
    for (const p of out.points.slice(0, -1)) {
      expect(p.attemptCount).toBe(0);
      expect(p.correctCount).toBe(0);
      expect(p.accuracyPct).toBe(0);
      expect(p.studyTimeMin).toBe(0);
    }
  });

  it("attemptCount=0 なら accuracyPct は 0 (ゼロ割り防止)", async () => {
    queue.push(() => []);
    const out = await fetchTrends({ userId: "u-1", days: 7 });
    for (const p of out.points) expect(p.accuracyPct).toBe(0);
  });

  it("studyTimeMs (ms 累積) を分に変換して小数 1 桁で丸める", async () => {
    const now = new Date("2026-04-18T05:00:00Z");
    queue.push(() => [
      // 1,234,567 ms ≈ 20.6 分
      { date: "2026-04-18", attemptCount: 1, correctCount: 1, studyTimeMs: 1_234_567 },
    ]);
    const out = await fetchTrends({ userId: "u-1", days: 7, now });
    const today = out.points.at(-1)!;
    expect(today.studyTimeMin).toBeCloseTo(20.6, 1);
  });
});
