"use client";

import { WifiOff } from "lucide-react";

import { useOnlineStatus } from "@/lib/offline/use-online-status";

/** オフライン状態を知らせる上部 banner (issue #40)。
 *  文言は保守的に「接続が戻るまで一部の操作ができません」に留める: IndexedDB が使えない
 *  (Safari private mode 等) ケースや currentUserId が取れないケースでは enqueue されず
 *  通常エラーに落ちるため、常に「自動送信されます」と断定できない (Codex PR#87 Round 1
 *  指摘 #2)。queue が動いたときは drill-screen 側の個別メッセージ「オフラインのため
 *  保留しました。オンライン復帰時に自動送信されます。」で明示する。 */
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
