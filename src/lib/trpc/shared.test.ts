import { describe, it, expect, afterEach, vi } from "vitest";

import { getTrpcUrl } from "./shared";

describe("getTrpcUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("サーバー (window 未定義) では絶対 URL を返す", () => {
    // vitest のデフォルトでは window が定義されていないので、そのまま確認できる
    expect(typeof window).toBe("undefined");
    expect(getTrpcUrl()).toMatch(/^https?:\/\/.+\/api\/trpc$/);
  });

  it("ブラウザ (window 定義) では相対パスを返す", () => {
    vi.stubGlobal("window", {});
    expect(getTrpcUrl()).toBe("/api/trpc");
  });
});
