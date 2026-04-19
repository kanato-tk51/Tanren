import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

type Builders = {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const builders: Builders = {
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@/db/client", () => ({
  getDb: () => builders,
}));

import {
  DEV_SESSION_COOKIE_NAME,
  LOCAL_BYPASS_OFF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
} from "./constants";
import { resolveSession } from "./session";

function mockCookieStore(values: Record<string, string>) {
  return {
    get: (name: string) => (values[name] ? { value: values[name] } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  } as unknown as Parameters<typeof resolveSession>[0];
}

function fluentSelect(rows: unknown[]) {
  const api = {
    from: () => api,
    innerJoin: () => api,
    where: () => api,
    limit: () => rows,
  };
  return api;
}

function fluentUpdateCapture(capture: { set?: unknown }) {
  const api = {
    set: (v: unknown) => {
      capture.set = v;
      return api;
    },
    where: async () => {},
  };
  return api;
}

describe("resolveSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cookie がない場合は null", async () => {
    const result = await resolveSession(mockCookieStore({}));
    expect(result).toBeNull();
  });

  it("cookie はあるが sessions_auth に見つからない/期限切れ → null", async () => {
    builders.select.mockReturnValue(fluentSelect([]));
    const result = await resolveSession(mockCookieStore({ [SESSION_COOKIE_NAME]: "expired" }));
    expect(result).toBeNull();
  });

  it("有効なセッションなら user と sessionId を返し sliding expiry を更新 (passkey)", async () => {
    const fakeUser = { id: "u1", email: "x@example.com" };
    builders.select.mockReturnValue(
      fluentSelect([{ session: { id: "s1", userId: "u1" }, user: fakeUser }]),
    );
    const capture: { set?: { expiresAt?: Date; lastActiveAt?: Date } } = {};
    builders.update.mockReturnValue(fluentUpdateCapture(capture));

    const before = Date.now();
    const result = await resolveSession(mockCookieStore({ [SESSION_COOKIE_NAME]: "s1" }));
    const after = Date.now();

    expect(result?.user).toEqual(fakeUser);
    expect(result?.kind).toBe("passkey");
    const expiresTs = capture.set!.expiresAt!.getTime();
    expect(expiresTs).toBeGreaterThanOrEqual(before + SESSION_MAX_AGE_MS - 1);
    expect(expiresTs).toBeLessThanOrEqual(after + SESSION_MAX_AGE_MS + 1);
  });

  it("VERCEL_ENV=production では dev cookie は無視される (認証バイパス防止)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEBAUTHN_RP_ID", "");
    vi.stubEnv("WEBAUTHN_ORIGIN", "");
    const result = await resolveSession(
      mockCookieStore({ [DEV_SESSION_COOKIE_NAME]: "dev-smuggled" }),
    );
    // DB select すら走らずに null が返る
    expect(result).toBeNull();
    expect(builders.select).not.toHaveBeenCalled();
  });

  it("self-host 本番 (VERCEL_ENV 未設定, NODE_ENV=production) でも dev cookie は無視される", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEBAUTHN_RP_ID", "");
    vi.stubEnv("WEBAUTHN_ORIGIN", "");
    const result = await resolveSession(
      mockCookieStore({ [DEV_SESSION_COOKIE_NAME]: "dev-smuggled" }),
    );
    expect(result).toBeNull();
    expect(builders.select).not.toHaveBeenCalled();
  });

  it("ローカル bypass 有効でも LOCAL_BYPASS_OFF cookie があれば null (ログアウト維持)", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    const result = await resolveSession(mockCookieStore({ [LOCAL_BYPASS_OFF_COOKIE_NAME]: "1" }));
    // bypass を skip、実 cookie も無いので null。DB には触れない。
    expect(result).toBeNull();
    expect(builders.select).not.toHaveBeenCalled();
    expect(builders.insert).not.toHaveBeenCalled();
  });

  it("ローカル bypass 有効 + 実 passkey cookie あり → 実 session を優先 (bypass 巻き込みなし)", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    const fakeUser = { id: "u1", email: "x@example.com" };
    builders.select.mockReturnValue(
      fluentSelect([{ session: { id: "s1", userId: "u1" }, user: fakeUser }]),
    );
    const capture: { set?: { expiresAt?: Date; lastActiveAt?: Date } } = {};
    builders.update.mockReturnValue(fluentUpdateCapture(capture));

    const result = await resolveSession(mockCookieStore({ [SESSION_COOKIE_NAME]: "s1" }));
    // bypass ではなく passkey として返る。insert (ensureLocalDevUser) は呼ばれない。
    expect(result?.user).toEqual(fakeUser);
    expect(result?.kind).toBe("passkey");
    expect(builders.insert).not.toHaveBeenCalled();
  });

  it("ローカル bypass 有効 + 実 passkey cookie あるが session 無し → null (bypass 救済しない)", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    builders.select.mockReturnValue(fluentSelect([]));
    const result = await resolveSession(mockCookieStore({ [SESSION_COOKIE_NAME]: "expired" }));
    // cookie が invalid なときは再ログインを促す (誤爆 bypass で足元を見失わないため)。
    expect(result).toBeNull();
    expect(builders.insert).not.toHaveBeenCalled();
  });
});
