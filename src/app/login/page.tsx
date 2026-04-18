import { isDevShortcutAvailable } from "@/server/auth/capabilities";

import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  // UI と /api/auth/dev-login の判定を同じ capability に揃える (dry)
  const showDevShortcut = isDevShortcutAvailable();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <LoginForm showDevShortcut={showDevShortcut} />
    </main>
  );
}
