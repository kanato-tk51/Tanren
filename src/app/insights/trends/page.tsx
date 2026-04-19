import { redirect } from "next/navigation";

import { TrendsScreen } from "@/features/insights/trends-screen";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboardingCompletedAt) redirect("/onboarding");
  return (
    <main className="flex min-h-screen flex-col items-center justify-start gap-6 p-6">
      <TrendsScreen />
    </main>
  );
}
