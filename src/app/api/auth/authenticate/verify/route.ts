import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { LOCAL_BYPASS_OFF_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/server/auth/constants";
import { createSession } from "@/server/auth/session";
import { isPasskeyEnabled, verifyAuthentication } from "@/server/auth/webauthn";

const BodySchema = z.object({
  challengeId: z.string().min(1),
  response: z.unknown(),
});

export async function POST(req: Request) {
  if (!isPasskeyEnabled()) {
    return NextResponse.json({ error: "Passkey is disabled" }, { status: 503 });
  }

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const { user } = await verifyAuthentication({
      challengeId: parsed.data.challengeId,
      response: parsed.data.response as Parameters<typeof verifyAuthentication>[0]["response"],
    });
    const { sessionId, cookie } = await createSession(user.id);
    const store = await cookies();
    store.set({ name: SESSION_COOKIE_NAME, value: sessionId, ...cookie });
    // 本物のログインが成立した時点で、ローカル bypass の opt-out フラグは不要。
    // 残っていても resolveSession は実 cookie を優先するが、stale な cookie を掃除しておく。
    store.delete(LOCAL_BYPASS_OFF_COOKIE_NAME);
    return NextResponse.json({ ok: true, user: { id: user.id, email: user.email } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "verification failed" },
      { status: 401 },
    );
  }
}
