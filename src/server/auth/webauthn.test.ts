import { describe, it, expect, vi, beforeEach } from "vitest";

type Builders = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

const builders: Builders = {
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/db/client", () => ({
  getDb: () => builders,
}));

// SimpleWebAuthn はネットワーク不要だが、ここでは consumeChallenge の挙動のみに興味があるので verify 側はモック化
vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

import { verifyRegistration } from "./webauthn";

function fluentDeleteReturning(rows: { challenge: string }[]) {
  const api = {
    where: () => api,
    returning: () => rows,
  };
  return api;
}

describe("verifyRegistration のチャレンジ消費", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBAUTHN_RP_ID = "localhost";
    process.env.WEBAUTHN_RP_NAME = "Tanren";
    process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
  });

  it("challenge が見つからない (or userId 不一致) と Error を投げる", async () => {
    builders.delete.mockReturnValue(fluentDeleteReturning([]));
    await expect(
      verifyRegistration({
        userId: "u-different",
        challengeId: "c-1",
        response: {} as Parameters<typeof verifyRegistration>[0]["response"],
      }),
    ).rejects.toThrow(/Challenge not found/);

    // DELETE ... RETURNING 1 ステートメントで消費している (SELECT→DELETE の 2 段階でない)
    expect(builders.delete).toHaveBeenCalledTimes(1);
    expect(builders.select).not.toHaveBeenCalled();
  });
});
