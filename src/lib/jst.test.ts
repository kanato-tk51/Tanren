import { describe, expect, it } from "vitest";

import { jstPeriodBounds, jstStartOfToday } from "./jst";

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

describe("jstPeriodBounds", () => {
  it("weekAgo は today から JST 換算で 6 日前 (= 今日を含む直近 7 日)", () => {
    const now = new Date("2026-04-19T03:00:00Z");
    const { today, weekAgo } = jstPeriodBounds(now);
    expect(today.toISOString()).toBe("2026-04-18T15:00:00.000Z");
    expect(weekAgo.toISOString()).toBe("2026-04-12T15:00:00.000Z");
  });
});
