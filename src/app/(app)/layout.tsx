import { redirect } from "next/navigation";

import { OfflineDrainer } from "@/features/offline/offline-drainer";
import { getCurrentUser } from "@/server/auth/session";

/** 認証必須ページを束ねる route group。`/login` / `/api` と違って全て `getCurrentUser`
 *  前提なので、ここで一回解決して `<OfflineDrainer />` を常駐させる (issue #40、
 *  Codex Round 5 指摘 #1)。
 *
 *  `/` (home) はこの group に含めない: 未ログインでも login 誘導 UI を出す挙動を
 *  変えないため (HomeScreen 側で drainer を mount している)。
 *
 *  子ページも依然 `getCurrentUser()` を呼ぶが、React.cache で dedup されるので
 *  同一 request 内の DB round-trip は 1 回のみ (session.ts)。
 */
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return (
    <>
      <OfflineDrainer userId={user.id} />
      {children}
    </>
  );
}
