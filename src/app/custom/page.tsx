import { redirect } from "next/navigation";

import { CustomScreen } from "@/features/custom/custom-screen";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function CustomPage({
  searchParams,
}: {
  searchParams?: Promise<{ prefill?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  const params = await searchParams;
  // Next.js の searchParams は string | string[] | undefined のため単一化してから渡す。
  // ?prefill=a&prefill=b のような多値クエリは先頭を採用。
  const rawParam = params?.prefill;
  const rawValue = Array.isArray(rawParam) ? rawParam[0] : rawParam;
  const initialRaw = typeof rawValue === "string" ? rawValue.slice(0, 2000) : undefined;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <CustomScreen initialRaw={initialRaw} />
    </main>
  );
}
