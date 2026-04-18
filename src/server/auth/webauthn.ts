import { randomUUID } from "node:crypto";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, eq, gt } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  credentials as credentialsTable,
  users as usersTable,
  webauthnChallenges as challengesTable,
  type CredentialDeviceType,
} from "@/db/schema";

import { WEBAUTHN_CHALLENGE_TTL_MS } from "./constants";

/** Passkey 利用時の rp 設定。Preview など RP_ID 未設定では使わない想定 */
function rpConfig() {
  const rpID = process.env.WEBAUTHN_RP_ID;
  const rpName = process.env.WEBAUTHN_RP_NAME ?? "Tanren";
  const origin = process.env.WEBAUTHN_ORIGIN;
  if (!rpID || !origin) {
    throw new Error("WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN is not set");
  }
  return { rpID, rpName, origin };
}

export function isPasskeyEnabled(): boolean {
  return Boolean(process.env.WEBAUTHN_RP_ID && process.env.WEBAUTHN_ORIGIN);
}

async function saveChallenge(params: {
  userId: string | null;
  challenge: string;
  purpose: "register" | "authenticate";
}) {
  const id = randomUUID();
  await getDb()
    .insert(challengesTable)
    .values({
      id,
      userId: params.userId,
      challenge: params.challenge,
      purpose: params.purpose,
      expiresAt: new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS),
    });
  return id;
}

async function consumeChallenge(params: {
  id: string;
  purpose: "register" | "authenticate";
}): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(challengesTable)
    .where(
      and(
        eq(challengesTable.id, params.id),
        eq(challengesTable.purpose, params.purpose),
        gt(challengesTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  await db.delete(challengesTable).where(eq(challengesTable.id, params.id));
  return row.challenge;
}

// ───────────────────────────────── Registration ─────────────────────────────────

export async function buildRegistrationOptions(params: { userId: string; userName: string }) {
  const { rpID, rpName } = rpConfig();
  const existing = await getDb()
    .select({ id: credentialsTable.id, transports: credentialsTable.transports })
    .from(credentialsTable)
    .where(eq(credentialsTable.userId, params.userId));

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: params.userName,
    userID: Buffer.from(params.userId),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
  });

  const challengeId = await saveChallenge({
    userId: params.userId,
    challenge: options.challenge,
    purpose: "register",
  });

  return { options, challengeId };
}

export async function verifyRegistration(params: {
  userId: string;
  challengeId: string;
  response: RegistrationResponseJSON;
  nickname?: string;
}) {
  const { rpID, origin } = rpConfig();
  const expectedChallenge = await consumeChallenge({
    id: params.challengeId,
    purpose: "register",
  });
  if (!expectedChallenge) {
    throw new Error("Challenge not found or expired");
  }

  const verification = await verifyRegistrationResponse({
    response: params.response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Registration verification failed");
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  await getDb()
    .insert(credentialsTable)
    .values({
      id: credential.id,
      userId: params.userId,
      publicKey: credential.publicKey,
      counter: BigInt(credential.counter),
      deviceType: credentialDeviceType as CredentialDeviceType,
      backedUp: credentialBackedUp,
      transports: (credential.transports as AuthenticatorTransportFuture[] | undefined) ?? [],
      nickname: params.nickname,
    });

  return { credentialId: credential.id };
}

// ─────────────────────────────── Authentication ────────────────────────────────

export async function buildAuthenticationOptions() {
  const { rpID } = rpConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });

  const challengeId = await saveChallenge({
    userId: null,
    challenge: options.challenge,
    purpose: "authenticate",
  });

  return { options, challengeId };
}

export async function verifyAuthentication(params: {
  challengeId: string;
  response: AuthenticationResponseJSON;
}) {
  const { rpID, origin } = rpConfig();
  const expectedChallenge = await consumeChallenge({
    id: params.challengeId,
    purpose: "authenticate",
  });
  if (!expectedChallenge) {
    throw new Error("Challenge not found or expired");
  }

  const db = getDb();
  const credentialId = params.response.id;
  const rows = await db
    .select()
    .from(credentialsTable)
    .innerJoin(usersTable, eq(usersTable.id, credentialsTable.userId))
    .where(eq(credentialsTable.id, credentialId))
    .limit(1);

  const found = rows[0];
  if (!found) {
    throw new Error("Unknown credential");
  }

  const verification = await verifyAuthenticationResponse({
    response: params.response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: found.credentials.id,
      // ArrayBufferLike → ArrayBuffer (bytea 由来の Buffer view が SharedArrayBuffer を含まない前提で安全に narrow)
      publicKey: new Uint8Array(found.credentials.publicKey),
      counter: Number(found.credentials.counter),
      transports:
        (found.credentials.transports as AuthenticatorTransportFuture[] | null) ?? undefined,
    },
    requireUserVerification: false,
  });

  if (!verification.verified) {
    throw new Error("Authentication verification failed");
  }

  await db
    .update(credentialsTable)
    .set({
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    })
    .where(eq(credentialsTable.id, credentialId));

  return { user: found.users, credentialId };
}
