import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { tanrenBeforeSend } from "./before-send";

const ORIGINAL_DSN = process.env.SENTRY_DSN;

beforeEach(() => {
  process.env.SENTRY_DSN = "https://example@sentry.io/1";
});
afterEach(() => {
  if (ORIGINAL_DSN === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = ORIGINAL_DSN;
});

describe("tanrenBeforeSend", () => {
  it("DSN 未設定時は null を返して送信しない", () => {
    delete process.env.SENTRY_DSN;
    const out = tanrenBeforeSend({ message: "test" } as never);
    expect(out).toBeNull();
  });

  it("request.headers.cookie / authorization を削除", () => {
    const event = {
      request: {
        headers: {
          cookie: "x",
          Cookie: "y",
          authorization: "z",
          Authorization: "w",
          "user-agent": "ua",
        },
      },
    } as never;
    const out = tanrenBeforeSend(event);
    expect(out?.request?.headers).toEqual({ "user-agent": "ua" });
  });

  it("request.cookies / query_string / data を削除", () => {
    const event = {
      request: {
        cookies: { sid: "x" },
        query_string: "secret=1",
        data: { password: "p" },
        url: "https://example.com",
      },
    } as never;
    const out = tanrenBeforeSend(event);
    expect(out?.request).toEqual({ url: "https://example.com" });
  });

  it("user の email / username / ip を落とし id だけ残す", () => {
    const event = {
      user: { id: "u-1", email: "x@y.z", username: "kanato", ip_address: "1.2.3.4" },
    } as never;
    const out = tanrenBeforeSend(event);
    expect(out?.user).toEqual({ id: "u-1" });
  });

  it("user.id が無ければ user 自体を消す", () => {
    const event = { user: { email: "x@y.z" } } as never;
    const out = tanrenBeforeSend(event);
    expect(out?.user).toBeUndefined();
  });

  it("contexts.device / os を削除", () => {
    const event = {
      contexts: {
        device: { model: "iPhone" },
        os: { name: "iOS" },
        runtime: { name: "node" },
      },
    } as never;
    const out = tanrenBeforeSend(event);
    expect(out?.contexts).toEqual({ runtime: { name: "node" } });
  });
});
