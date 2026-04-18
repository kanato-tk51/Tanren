import { describe, it, expect, beforeEach, vi } from "vitest";

describe("env", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("appUrl falls back to localhost when nothing is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    const { appUrl } = await import("./env");
    expect(appUrl).toBe("http://localhost:3000");
  });

  it("appUrl uses NEXT_PUBLIC_APP_URL when provided", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tanren.vercel.app");
    const { appUrl } = await import("./env");
    expect(appUrl).toBe("https://tanren.vercel.app");
  });

  it("appUrl uses VERCEL_URL as Preview fallback", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_URL", "tanren-abc.vercel.app");
    const { appUrl } = await import("./env");
    expect(appUrl).toBe("https://tanren-abc.vercel.app");
  });

  it("passkeyEnabled reflects WEBAUTHN_RP_ID presence", async () => {
    vi.stubEnv("WEBAUTHN_RP_ID", "localhost");
    const { passkeyEnabled } = await import("./env");
    expect(passkeyEnabled).toBe(true);
  });

  it("passkeyEnabled is false when WEBAUTHN_RP_ID is empty", async () => {
    vi.stubEnv("WEBAUTHN_RP_ID", "");
    const { passkeyEnabled } = await import("./env");
    expect(passkeyEnabled).toBe(false);
  });
});
