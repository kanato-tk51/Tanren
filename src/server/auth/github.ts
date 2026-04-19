import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { users, type User } from "@/db/schema";

/** Authorization Code + PKCE (S256) の最小実装 (ADR-0006)。
 *  @octokit/* 等は入れず、OAuth エンドポイント 3 本の直叩き + Zod で JSON を validate する。
 */

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

/** OAuth フロー中に cookie に詰めて持ち運ぶペイロード。login → callback 間で検証する。 */
export type OAuthStatePayload = {
  state: string;
  codeVerifier: string;
};

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function generatePkce(): OAuthStatePayload {
  const state = base64UrlEncode(randomBytes(24));
  const codeVerifier = base64UrlEncode(randomBytes(32));
  return { state, codeVerifier };
}

export function codeChallengeFromVerifier(codeVerifier: string): string {
  return base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
}

/** 環境変数から GitHub OAuth 設定を読む。不備は 500 相当として throw する。 */
export function loadGithubOAuthConfig(): {
  clientId: string;
  clientSecret: string;
  allowedUserId: number;
} {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const allowedUserIdRaw = process.env.GITHUB_ALLOWED_USER_ID;
  if (!clientId || !clientSecret || !allowedUserIdRaw) {
    throw new Error("GitHub OAuth env vars are missing");
  }
  const allowedUserId = Number(allowedUserIdRaw);
  if (!Number.isInteger(allowedUserId) || allowedUserId <= 0) {
    throw new Error("GITHUB_ALLOWED_USER_ID must be a positive integer");
  }
  return { clientId, clientSecret, allowedUserId };
}

/** callback URL は login / callback の両方で同じ値を GitHub に提示する必要がある。
 *  GitHub OAuth App 登録時の Authorization callback URL とも一致させる。 */
export function callbackUrl(request: Request): string {
  const override = process.env.GITHUB_CALLBACK_URL;
  if (override) return override;
  const url = new URL(request.url);
  return `${url.origin}/api/auth/github/callback`;
}

export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const u = new URL(GITHUB_AUTHORIZE_URL);
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("state", args.state);
  u.searchParams.set("code_challenge", args.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  // user:email を付けて primary email も取れるようにする (Codex PR#86 Round 1 指摘 #2:
  // Weekly Digest が users.email IS NOT NULL でフィルタしているため email が null だと
  // opt-out 方式が実質的に効かなくなる)。
  u.searchParams.set("scope", "read:user user:email");
  return u.toString();
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  scope: z.string().optional(),
});

const GithubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
});
export type GithubUser = z.infer<typeof GithubUserSchema>;

const GithubEmailsSchema = z.array(
  z.object({
    email: z.string().email(),
    primary: z.boolean(),
    verified: z.boolean(),
  }),
);

/** code + code_verifier で access token に交換する。 */
export async function exchangeCodeForToken(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<string> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      redirect_uri: args.redirectUri,
      code_verifier: args.codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: ${res.status}`);
  }
  const parsed = TokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("GitHub token response malformed");
  }
  return parsed.data.access_token;
}

/** `/user/emails` から primary かつ verified な email を返す。取れなければ null。
 *  `/user` の email が null (private 設定) の場合のフォールバック。scope に `user:email`
 *  が必要 (ADR-0006 で authorize URL に付与済み)。 */
export async function fetchPrimaryEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://api.github.com/user/emails", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "tanren-auth",
    },
  });
  if (!res.ok) return null;
  const parsed = GithubEmailsSchema.safeParse(await res.json());
  if (!parsed.success) return null;
  const primary = parsed.data.find((e) => e.primary && e.verified);
  return primary?.email ?? null;
}

/** token で GitHub user 情報を取得。allowlist 照合の入力。 */
export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const res = await fetch(GITHUB_USER_URL, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "tanren-auth",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub user fetch failed: ${res.status}`);
  }
  const parsed = GithubUserSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("GitHub user response malformed");
  }
  return parsed.data;
}

/** GitHub user id から紐付く user row を返す。allowlist を通過した後に呼ぶ前提なので、
 *  該当ユーザーが users テーブルに存在しなければ「まだ bootstrap されていない」状態として
 *  null を返す。 */
export async function findUserByGithubId(githubUserId: number): Promise<User | null> {
  const rows = await getDb()
    .select()
    .from(users)
    .where(and(eq(users.githubUserId, githubUserId), isNotNull(users.githubUserId)))
    .limit(1);
  return rows[0] ?? null;
}

/** login → callback に運ぶ state cookie を JSON で扱う。httpOnly + Secure + SameSite=Lax。
 *  login 画面から直接 GitHub に飛ぶため SameSite=Lax でないと callback 到着時に cookie が
 *  送られない。 */
export function serializeOAuthState(payload: OAuthStatePayload): string {
  return JSON.stringify(payload);
}

export function deserializeOAuthState(raw: string): OAuthStatePayload | null {
  try {
    const v = JSON.parse(raw);
    if (
      typeof v === "object" &&
      v !== null &&
      typeof v.state === "string" &&
      typeof v.codeVerifier === "string"
    ) {
      return { state: v.state, codeVerifier: v.codeVerifier };
    }
  } catch {
    // fall through
  }
  return null;
}
