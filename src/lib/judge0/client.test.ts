import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  executeCode,
  JUDGE0_MAX_SOURCE_BYTES,
  Judge0DisabledError,
  Judge0RequestError,
} from "./client";

const ORIG_URL = process.env.JUDGE0_URL;
const ORIG_KEY = process.env.JUDGE0_API_KEY;
const ORIG_HOST = process.env.JUDGE0_API_HOST;

beforeEach(() => {
  process.env.JUDGE0_URL = "https://judge0-ce.p.rapidapi.com";
  process.env.JUDGE0_API_KEY = "test-key";
  process.env.JUDGE0_API_HOST = "judge0-ce.p.rapidapi.com";
});
afterEach(() => {
  process.env.JUDGE0_URL = ORIG_URL;
  process.env.JUDGE0_API_KEY = ORIG_KEY;
  process.env.JUDGE0_API_HOST = ORIG_HOST;
  vi.restoreAllMocks();
});

describe("executeCode", () => {
  it("JUDGE0_API_KEY 未設定なら Judge0DisabledError", async () => {
    delete process.env.JUDGE0_API_KEY;
    await expect(executeCode({ language: "python", source: "print(1)" })).rejects.toBeInstanceOf(
      Judge0DisabledError,
    );
  });

  it("JUDGE0_URL 未設定なら Judge0DisabledError", async () => {
    delete process.env.JUDGE0_URL;
    await expect(executeCode({ language: "python", source: "print(1)" })).rejects.toBeInstanceOf(
      Judge0DisabledError,
    );
  });

  it("source サイズ超過は Judge0RequestError", async () => {
    await expect(
      executeCode({ language: "python", source: "x".repeat(JUDGE0_MAX_SOURCE_BYTES + 1) }),
    ).rejects.toBeInstanceOf(Judge0RequestError);
  });

  it("正常系: base64 で stdout / stderr をデコードして返す", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          stdout: Buffer.from("hello\n", "utf-8").toString("base64"),
          stderr: null,
          status: { description: "Accepted" },
          time: "0.012",
          memory: 3096,
          token: "tok-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const out = await executeCode({ language: "python", source: "print('hello')" });
    expect(out.stdout).toBe("hello\n");
    expect(out.stderr).toBe("");
    expect(out.status).toBe("Accepted");
    expect(out.timeSec).toBeCloseTo(0.012);
    expect(out.memoryKb).toBe(3096);
    expect(out.token).toBe("tok-1");
    // endpoint の組み立て確認
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/submissions?base64_encoded=true&wait=true");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers["X-RapidAPI-Key"]).toBe("test-key");
    expect(headers["X-RapidAPI-Host"]).toBe("judge0-ce.p.rapidapi.com");
    // body は base64 エンコード済みの source_code を含む
    const body = JSON.parse((init as { body: string }).body);
    expect(body.language_id).toBe(71); // python
    expect(Buffer.from(body.source_code, "base64").toString("utf-8")).toBe("print('hello')");
  });

  it("429 は Judge0RequestError に statusCode 付きで throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limit", { status: 429 }));
    try {
      await executeCode({ language: "python", source: "x" });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Judge0RequestError);
      expect((e as Judge0RequestError).statusCode).toBe(429);
    }
  });

  it("未対応言語は Judge0RequestError", async () => {
    await expect(executeCode({ language: "cobol" as never, source: "x" })).rejects.toBeInstanceOf(
      Judge0RequestError,
    );
  });
});
