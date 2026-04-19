"use client";

import { WifiOff } from "lucide-react";

import { useOnlineStatus } from "@/lib/offline/use-online-status";

/** オフライン状態を知らせる上部 banner (issue #40)。
 *  MVP は表示のみ (復帰時の自動送信は OfflineDrainer コンポーネントが担当)。 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-destructive text-destructive-foreground fixed top-0 right-0 left-0 z-50 flex items-center justify-center gap-2 py-1 text-xs"
    >
      <WifiOff className="h-3 w-3" aria-hidden="true" />
      オフライン — 回答は端末に保留され、復帰時に自動送信されます
    </div>
  );
}
