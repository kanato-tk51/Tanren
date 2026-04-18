import { isPasskeyEnabled } from "@/server/auth/webauthn";

import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  // Dev ショートカットは「本番 (Vercel) でなく、かつ Passkey も無効」なときだけ意味がある。
  // それ以外では /api/auth/dev-login が必ず拒否するので UI からも隠す。
  const showDevShortcut = process.env.VERCEL_ENV !== "production" && !isPasskeyEnabled();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <LoginForm showDevShortcut={showDevShortcut} />
    </main>
  );
}
