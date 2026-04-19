import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/session";

import { DrillScreen } from "@/features/drill/drill-screen";

export const dynamic = "force-dynamic";

export default async function DrillPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <DrillScreen />
    </main>
  );
}
