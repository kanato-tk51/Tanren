import { redirect } from "next/navigation";

import { ReviewScreen } from "@/features/review/review-screen";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <ReviewScreen />
    </main>
  );
}
