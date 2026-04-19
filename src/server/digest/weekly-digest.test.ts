import { describe, expect, it } from "vitest";

import { renderDigestHtml, type DigestMetrics } from "./weekly-digest";

function metrics(over: Partial<DigestMetrics> = {}): DigestMetrics {
  return {
    userId: "u-1",
    email: "x@y.z",
    displayName: "Kanato",
    attemptCount: 12,
    correctCount: 9,
    studyTimeMin: 45.2,
    conceptsTouched: 5,
    ...over,
  };
}

describe("renderDigestHtml", () => {
  it("displayName / 出題数 / 正答率 / 学習時間 / concept 数を含む", () => {
    const html = renderDigestHtml(metrics());
    expect(html).toMatch(/Kanato/);
    expect(html).toMatch(/12 問/);
    expect(html).toMatch(/75%/); // 9/12
    expect(html).toMatch(/45\.2 分/);
    expect(html).toMatch(/<strong>5<\/strong>/);
  });

  it("attemptCount=0 のときは accuracy '-' を表示", () => {
    const html = renderDigestHtml(metrics({ attemptCount: 0, correctCount: 0 }));
    expect(html).toMatch(/<td>正答率<\/td><td><strong>-<\/strong>/);
  });

  it("displayName が null の時は email で代替", () => {
    const html = renderDigestHtml(metrics({ displayName: null }));
    expect(html).toMatch(/x@y\.z/);
  });

  it("HTML エスケープ: <script> などを &lt; に", () => {
    const html = renderDigestHtml(metrics({ displayName: "<script>alert(1)</script>" }));
    expect(html).not.toMatch(/<script>/);
    expect(html).toMatch(/&lt;script&gt;/);
  });
});
