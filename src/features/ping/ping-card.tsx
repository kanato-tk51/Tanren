"use client";

import { trpc } from "@/lib/trpc/react";

/** tRPC 疎通確認用の最小 UI。Phase 0 でのみ使い、認証導入後に差し替える想定 */
export function PingCard() {
  const ping = trpc.ping.useQuery(undefined, { staleTime: Infinity });

  return (
    <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
      <div className="font-medium">tRPC ping</div>
      <div className="mt-1 font-mono text-xs">
        {ping.isLoading && "…"}
        {ping.isError && `error: ${ping.error.message}`}
        {ping.data?.message}
      </div>
    </div>
  );
}
