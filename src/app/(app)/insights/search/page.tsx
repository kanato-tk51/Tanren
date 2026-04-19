import { redirect } from "next/navigation";

import { SearchScreen } from "@/features/insights/search-screen";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function InsightsSearchPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <SearchScreen />
    </main>
  );
}
