import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/server/auth/session";
import { isPasskeyEnabled, verifyRegistration } from "@/server/auth/webauthn";

const BodySchema = z.object({
  challengeId: z.string().min(1),
  // @simplewebauthn/browser が返す JSON をそのまま受け取る。内容は SimpleWebAuthn 側で厳密検証するためここは緩く
  response: z.unknown(),
  nickname: z.string().min(1).max(50).optional(),
});

export async function POST(req: Request) {
  if (!isPasskeyEnabled()) {
    return NextResponse.json({ error: "Passkey is disabled" }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const result = await verifyRegistration({
      userId: user.id,
      challengeId: parsed.data.challengeId,
      // SimpleWebAuthn 側で形を強く検証するので unknown を渡す
      response: parsed.data.response as Parameters<typeof verifyRegistration>[0]["response"],
      nickname: parsed.data.nickname,
    });
    return NextResponse.json({ ok: true, credentialId: result.credentialId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "verification failed" },
      { status: 400 },
    );
  }
}
