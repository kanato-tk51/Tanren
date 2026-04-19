import { redirect } from "next/navigation";

import { OnboardingScreen } from "@/features/onboarding/onboarding-screen";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  // auth 判定は (app)/layout.tsx で済み。ここは「完了済みなら / に戻す」追加条件のみ。
  const user = await getCurrentUser();
  if (user?.onboardingCompletedAt) {
    redirect("/");
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <OnboardingScreen />
    </main>
  );
}
