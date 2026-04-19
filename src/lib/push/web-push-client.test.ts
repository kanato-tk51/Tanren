import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

import webpush from "web-push";

import { sendPushNotification, webPushPublicKey } from "./web-push-client";

const ORIG_PUB = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
const ORIG_PRIV = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
const ORIG_NPUB = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;

beforeEach(() => {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "pub-key";
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "priv-key";
  process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY = "npub-key";
});
afterEach(() => {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = ORIG_PUB;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = ORIG_PRIV;
  process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY = ORIG_NPUB;
  vi.clearAllMocks();
});

describe("sendPushNotification", () => {
  it("VAPID 未設定なら ok:false / statusCode 501", async () => {
    delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    const out = await sendPushNotification({
      endpoint: "https://push.example/abc",
      p256dh: "p",
      auth: "a",
      payload: { title: "hi", body: "b" },
    });
    expect(out).toEqual({ ok: false, statusCode: 501, message: "VAPID keys not configured" });
  });

  it("正常系: webpush.sendNotification を呼ぶ", async () => {
    vi.mocked(webpush.sendNotification).mockResolvedValueOnce({} as never);
    const out = await sendPushNotification({
      endpoint: "https://push.example/abc",
      p256dh: "p",
      auth: "a",
      payload: { title: "hi", body: "b", url: "/drill" },
    });
    expect(out).toEqual({ ok: true });
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    const call = vi.mocked(webpush.sendNotification).mock.calls[0]!;
    expect(call[0]).toEqual({
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(JSON.parse(call[1] as string)).toEqual({ title: "hi", body: "b", url: "/drill" });
  });

  it("410 Gone は ok:false / statusCode 410", async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce({
      statusCode: 410,
      body: "Gone",
    });
    const out = await sendPushNotification({
      endpoint: "https://push.example/dead",
      p256dh: "p",
      auth: "a",
      payload: { title: "x", body: "y" },
    });
    expect(out).toEqual({ ok: false, statusCode: 410, message: "Gone" });
  });
});

describe("webPushPublicKey", () => {
  it("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY の値を返す", () => {
    expect(webPushPublicKey()).toBe("npub-key");
  });

  it("未設定なら null", () => {
    delete process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
    expect(webPushPublicKey()).toBeNull();
  });
});
