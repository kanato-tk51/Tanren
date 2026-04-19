import { redirect } from "next/navigation";

import { SettingsScreen } from "@/features/settings/settings-screen";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboardingCompletedAt) redirect("/onboarding");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <SettingsScreen />
    </main>
  );
}
