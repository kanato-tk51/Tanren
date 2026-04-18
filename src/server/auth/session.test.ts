import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { SESSION_COOKIE_NAME } from "./constants";
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

function fluentUpdate() {
  const api = {
    set: () => api,
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
    const result = await resolveSession(
      mockCookieStore({ [SESSION_COOKIE_NAME]: "expired-session" }),
    );
    expect(result).toBeNull();
  });

  it("有効なセッションなら user を返し last_active_at を更新する", async () => {
    const fakeUser = { id: "u1", email: "x@example.com" };
    builders.select.mockReturnValue(
      fluentSelect([{ session: { id: "s1", userId: "u1" }, user: fakeUser }]),
    );
    builders.update.mockReturnValue(fluentUpdate());

    const result = await resolveSession(mockCookieStore({ [SESSION_COOKIE_NAME]: "s1" }));
    expect(result?.user).toEqual(fakeUser);
    expect(result?.sessionId).toBe("s1");
    expect(builders.update).toHaveBeenCalled();
  });
});
