import { redirect } from "next/navigation";

import { CustomScreen } from "@/features/custom/custom-screen";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function CustomPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <CustomScreen />
    </main>
  );
}
