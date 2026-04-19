import { redirect } from "next/navigation";

import { SettingsScreen } from "@/features/settings/settings-screen";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // auth 判定は (app)/layout.tsx で済み。onboarding 未完了の追加 redirect のみ。
  const user = await getCurrentUser();
  if (user && !user.onboardingCompletedAt) redirect("/onboarding");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <SettingsScreen />
    </main>
  );
}
