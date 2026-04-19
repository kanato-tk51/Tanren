"use client";

import { createContext, useContext, type ReactNode } from "react";

/** `(app)/layout.tsx` で resolve 済みの userId を authenticated subtree で即時利用できるよう
 *  する client context。`trpc.auth.me.useQuery` の完了待ちによるタイミング依存を避けるため
 *  (Codex PR#87 Round 2 指摘 #1)、server-resolved な値をそのまま子ツリーに流す。 */
const UserIdContext = createContext<string | null>(null);

export function UserIdProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <UserIdContext.Provider value={userId}>{children}</UserIdContext.Provider>;
}

/** authenticated subtree 内で呼ぶ。layout でラップされていない場合は null を返す
 *  (public route から誤って呼ばれた場合の防御)。 */
export function useUserId(): string | null {
  return useContext(UserIdContext);
}
