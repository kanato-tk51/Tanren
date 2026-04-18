import { isDevShortcutAvailable } from "@/server/auth/capabilities";

import { LoginForm } from "@/features/auth/login-form";

/**
 * `/login` は build once → deploy many な運用でも UI と API の capability 判定が
 * 必ず request-time で揃うよう、動的レンダーに固定する。
 */
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const showDevShortcut = isDevShortcutAvailable();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <LoginForm showDevShortcut={showDevShortcut} />
    </main>
  );
}
