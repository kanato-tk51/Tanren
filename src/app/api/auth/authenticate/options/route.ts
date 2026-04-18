import { NextResponse } from "next/server";

import { buildAuthenticationOptions, isPasskeyEnabled } from "@/server/auth/webauthn";

export async function POST() {
  if (!isPasskeyEnabled()) {
    return NextResponse.json({ error: "Passkey is disabled" }, { status: 503 });
  }

  const { options, challengeId } = await buildAuthenticationOptions();
  return NextResponse.json({ options, challengeId });
}
