"use client";

import { useSyncExternalStore } from "react";

/** ブラウザのオンライン/オフライン状態を subscribe する hook (issue #40)。
 *  navigator.onLine は偽陰性がある (LAN 接続ありでインターネット不通) が MVP は許容。
 *
 *  useSyncExternalStore で server snapshot を true に固定し、client snapshot で
 *  navigator.onLine を読む。React が hydration → client snapshot への切り替えを
 *  適切に扱うので hydration mismatch warning は出ない (Codex Round 4 指摘 #2)。
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getClientSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
