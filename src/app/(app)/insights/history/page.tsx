import { redirect } from "next/navigation";

import { HistoryScreen } from "@/features/insights/history-screen";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function InsightsHistoryPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <HistoryScreen />
    </main>
  );
}
