"use client";

import { WifiOff } from "lucide-react";

import { useOnlineStatus } from "@/lib/offline/use-online-status";

/** オフライン状態を知らせる上部 banner (issue #40)。
 *  本 PR では接続状態表示のみ。保留キュー (OfflineDrainer / enqueueSubmit) の caller 配線は
 *  follow-up PR で行うため、banner 文言も「自動送信」等の実挙動に反する断定を避け、
 *  単に接続状態を示すだけにしている (Codex Round 2 指摘 #1)。 */
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
      オフライン — 接続が戻るまで一部の操作ができません
    </div>
  );
}
