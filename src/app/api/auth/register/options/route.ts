import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/session";
import { buildRegistrationOptions, isPasskeyEnabled } from "@/server/auth/webauthn";

export async function POST() {
  if (!isPasskeyEnabled()) {
    return NextResponse.json({ error: "Passkey is disabled in this environment" }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Must be logged in to add a passkey" }, { status: 401 });
  }

  const { options, challengeId } = await buildRegistrationOptions({
    userId: user.id,
    userName: user.email,
  });

  return NextResponse.json({ options, challengeId });
}
