import { describe, expect, it } from "vitest";

import { tanrenBeforeSend } from "./before-send";

// 注意: DSN 有無のチェックは beforeSend から削除済み (Codex Round 1 指摘 #1)。
// 未設定時の skip は Sentry.init 側で行われるため、beforeSend 自体は常に sanitize を行う。

describe("tanrenBeforeSend", () => {
  it("機密ヘッダ (cookie / authorization / x-api-key / x-auth-token / x-csrf-token / proxy-authorization / set-cookie) を case-insensitive に削除", () => {
    const event = {
      request: {
        headers: {
          cookie: "x",
          Cookie: "y",
          authorization: "z",
          Authorization: "w",
          "Proxy-Authorization": "p",
          "X-API-Key": "k",
          "x-auth-token": "t",
          "X-Csrf-Token": "c",
          "set-cookie": "s",
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

  it("request.url の query string と fragment を削除", () => {
    const event = {
      request: {
        url: "https://example.com/drill?token=abc&sid=xyz#section",
      },
    } as never;
    const out = tanrenBeforeSend(event);
    expect(out?.request?.url).toBe("https://example.com/drill");
  });

  it("breadcrumbs の fetch / xhr / navigation の url / to / from から query を落とす", () => {
    const event = {
      breadcrumbs: [
        { category: "fetch", data: { url: "https://api.example.com/x?auth=t" } },
        {
          category: "navigation",
          data: {
            from: "/a?x=1",
            to: "/b?y=2#frag",
          },
        },
        { category: "console", message: "hi" }, // data 無しでも crash しない
      ],
    } as never;
    const out = tanrenBeforeSend(event);
    expect(out?.breadcrumbs?.[0]?.data).toEqual({ url: "https://api.example.com/x" });
    expect(out?.breadcrumbs?.[1]?.data).toEqual({ from: "/a", to: "/b" });
    expect(out?.breadcrumbs?.[2]).toEqual({ category: "console", message: "hi" });
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
