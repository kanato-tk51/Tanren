import { redirect } from "next/navigation";

import { UserIdProvider } from "@/features/auth/user-context";
import { OfflineDrainer } from "@/features/offline/offline-drainer";
import { getCurrentUser } from "@/server/auth/session";

/** 認証必須ページを束ねる route group。`/login` / `/api` と違って全て `getCurrentUser`
 *  前提なので、ここで一回解決して `<OfflineDrainer />` を常駐させる (issue #40、
 *  Codex PR#84 Round 5 指摘 #1)。
 *
 *  `/` (home) はこの group に含めない: 未ログインでも login 誘導 UI を出す挙動を
 *  変えないため (HomeScreen 側で drainer を mount している)。
 *
 *  `<UserIdProvider>` で userId を client context として流す。DrillScreen 等が
 *  offline enqueue に必要な userId を `trpc.auth.me.useQuery` の完了待ちなしで
 *  参照できるようにする (Codex PR#87 Round 2 指摘 #1)。
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
    <UserIdProvider userId={user.id}>
      <OfflineDrainer userId={user.id} />
      {children}
    </UserIdProvider>
  );
}
