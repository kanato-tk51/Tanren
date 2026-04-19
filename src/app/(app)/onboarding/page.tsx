import { redirect } from "next/navigation";

import { OnboardingScreen } from "@/features/onboarding/onboarding-screen";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  // 既に完了しているユーザーは Home に戻す (戻るボタンや手打ち URL での再訪を吸収)
  if (user.onboardingCompletedAt) {
    redirect("/");
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <OnboardingScreen />
    </main>
  );
}
