import { afterEach, describe, expect, it, vi } from "vitest";

import { isDevShortcutAvailable } from "./capabilities";

function setEnv(partial: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) {
      vi.stubEnv(key, "");
      delete process.env[key];
    } else {
      vi.stubEnv(key, value);
    }
  }
}

describe("isDevShortcutAvailable", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Passkey 有効なら常に false", () => {
    setEnv({
      WEBAUTHN_RP_ID: "localhost",
      WEBAUTHN_ORIGIN: "http://localhost:3000",
      VERCEL_ENV: "development",
      NODE_ENV: "development",
    });
    expect(isDevShortcutAvailable()).toBe(false);
  });

  it("Vercel production は false", () => {
    setEnv({
      WEBAUTHN_RP_ID: undefined,
      WEBAUTHN_ORIGIN: undefined,
      VERCEL_ENV: "production",
      NODE_ENV: "production",
    });
    expect(isDevShortcutAvailable()).toBe(false);
  });

  it("Vercel preview は true (Passkey 無効時)", () => {
    setEnv({
      WEBAUTHN_RP_ID: undefined,
      WEBAUTHN_ORIGIN: undefined,
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
    });
    expect(isDevShortcutAvailable()).toBe(true);
  });

  it("self-host next start (NODE_ENV=production, VERCEL_ENV なし) は false — 認証バイパス防止", () => {
    setEnv({
      WEBAUTHN_RP_ID: undefined,
      WEBAUTHN_ORIGIN: undefined,
      VERCEL_ENV: undefined,
      NODE_ENV: "production",
    });
    expect(isDevShortcutAvailable()).toBe(false);
  });

  it("ローカル next dev は true (Passkey 無効時)", () => {
    setEnv({
      WEBAUTHN_RP_ID: undefined,
      WEBAUTHN_ORIGIN: undefined,
      VERCEL_ENV: undefined,
      NODE_ENV: "development",
    });
    expect(isDevShortcutAvailable()).toBe(true);
  });
});
