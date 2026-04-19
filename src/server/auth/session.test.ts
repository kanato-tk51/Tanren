import "server-only";

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

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

import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from "./constants";
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

  it("cookie がない場合は null", async () => {
    const result = await resolveSession(mockCookieStore({}));
    expect(result).toBeNull();
  });

  it("cookie はあるが sessions_auth に見つからない/期限切れ → null", async () => {
    builders.select.mockReturnValue(fluentSelect([]));
    const result = await resolveSession(mockCookieStore({ [SESSION_COOKIE_NAME]: "expired" }));
    expect(result).toBeNull();
  });

  it("有効なセッションなら user と sessionId を返し sliding expiry を更新", async () => {
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
    const expiresTs = capture.set!.expiresAt!.getTime();
    expect(expiresTs).toBeGreaterThanOrEqual(before + SESSION_MAX_AGE_MS - 1);
    expect(expiresTs).toBeLessThanOrEqual(after + SESSION_MAX_AGE_MS + 1);
  });

  it("unknown cookie (旧 dev session 等) は無視される", async () => {
    // ADR-0006 以降は SESSION_COOKIE_NAME 1 本のみ信用する。
    const result = await resolveSession(mockCookieStore({ tanren_dev_session: "dev-smuggled" }));
    expect(result).toBeNull();
    expect(builders.select).not.toHaveBeenCalled();
  });
});
