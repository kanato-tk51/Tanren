import { describe, it, expect, afterEach, vi } from "vitest";

import {
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  deserializeOAuthState,
  generatePkce,
  loadGithubOAuthConfig,
  serializeOAuthState,
  type OAuthStatePayload,
} from "./github";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generatePkce", () => {
  it("state と codeVerifier を base64url で返す (区切り記号が無い)", () => {
    const p = generatePkce();
    expect(p.state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(p.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(p.state.length).toBeGreaterThanOrEqual(20);
    expect(p.codeVerifier.length).toBeGreaterThanOrEqual(40);
  });

  it("呼ぶたびに別の値になる", () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe("codeChallengeFromVerifier", () => {
  it("RFC 7636 の参照例で S256 challenge が一致する", () => {
    // dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(codeChallengeFromVerifier(verifier)).toBe(expected);
  });
});

describe("loadGithubOAuthConfig", () => {
  it("3 つとも揃えば正常に読める", () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "abc");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "sec");
    vi.stubEnv("GITHUB_ALLOWED_USER_ID", "12345");
    const c = loadGithubOAuthConfig();
    expect(c.clientId).toBe("abc");
    expect(c.clientSecret).toBe("sec");
    expect(c.allowedUserId).toBe(12345);
  });

  it("いずれかが欠けると Error", () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "sec");
    vi.stubEnv("GITHUB_ALLOWED_USER_ID", "12345");
    expect(() => loadGithubOAuthConfig()).toThrowError(/missing/);
  });

  it("GITHUB_ALLOWED_USER_ID が整数でないと Error", () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "abc");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "sec");
    vi.stubEnv("GITHUB_ALLOWED_USER_ID", "not-a-number");
    expect(() => loadGithubOAuthConfig()).toThrowError(/positive integer/);
  });

  it("GITHUB_ALLOWED_USER_ID が 0 以下だと Error", () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "abc");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "sec");
    vi.stubEnv("GITHUB_ALLOWED_USER_ID", "0");
    expect(() => loadGithubOAuthConfig()).toThrowError(/positive integer/);
  });
});

describe("buildAuthorizeUrl", () => {
  it("GitHub authorize の必要なパラメータを全て含む", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "cid",
        redirectUri: "https://tanren.example.com/api/auth/github/callback",
        state: "abc",
        codeChallenge: "def",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://tanren.example.com/api/auth/github/callback",
    );
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("code_challenge")).toBe("def");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("read:user");
  });
});

describe("serializeOAuthState / deserializeOAuthState", () => {
  it("対称: serialize → deserialize で同じ値に戻る", () => {
    const p: OAuthStatePayload = { state: "s", codeVerifier: "v" };
    const decoded = deserializeOAuthState(serializeOAuthState(p));
    expect(decoded).toEqual(p);
  });

  it("壊れた JSON は null", () => {
    expect(deserializeOAuthState("{not json")).toBeNull();
  });

  it("必須 key が欠けると null (型検証)", () => {
    expect(deserializeOAuthState(JSON.stringify({ state: "x" }))).toBeNull();
    expect(deserializeOAuthState(JSON.stringify({ codeVerifier: "x" }))).toBeNull();
    expect(deserializeOAuthState(JSON.stringify({ state: 1, codeVerifier: "x" }))).toBeNull();
  });
});
