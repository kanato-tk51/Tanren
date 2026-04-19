import { notFound, redirect } from "next/navigation";

import { DOMAIN_IDS, type DomainId } from "@/db/schema";
import { DeepDiveScreen } from "@/features/deep-dive/deep-dive-screen";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

function isDomainId(v: string): v is DomainId {
  return (DOMAIN_IDS as readonly string[]).includes(v);
}

export default async function DeepDivePage({
  params,
  searchParams,
}: {
  params: Promise<{ domain: string }>;
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}) {
  // auth 判定と /login redirect は (app)/layout.tsx で既に済んでいる。ここでは
  // onboarding 未完了の追加チェックだけを行う (React.cache で DB round-trip は layout と
  // 合算しても 1 回)。
  const user = await getCurrentUser();
  if (user && !user.onboardingCompletedAt) redirect("/onboarding");

  const { domain } = await params;
  if (!isDomainId(domain)) notFound();

  const sp = await searchParams;
  const rawReturnTo = Array.isArray(sp?.returnTo) ? sp?.returnTo[0] : sp?.returnTo;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <DeepDiveScreen domainId={domain} returnTo={rawReturnTo} />
    </main>
  );
}
