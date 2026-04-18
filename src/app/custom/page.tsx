import { redirect } from "next/navigation";

import { CustomScreen } from "@/features/custom/custom-screen";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function CustomPage({
  searchParams,
}: {
  searchParams?: Promise<{ prefill?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  const params = await searchParams;
  // Insights 等から ?prefill=概念名 で遷移したときは初期 raw にセットする。
  const initialRaw = params?.prefill?.slice(0, 2000) ?? undefined;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <CustomScreen initialRaw={initialRaw} />
    </main>
  );
}
