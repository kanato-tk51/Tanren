"use client";

import { useEffect, useState } from "react";

/** ブラウザのオンライン/オフライン状態を subscribe する hook (issue #40)。
 *  SSR 時は true を返す (ネットワークなし前提のレンダリング最小化)。
 *  navigator.onLine は偽陰性がある (LAN 接続ありでインターネット不通) が MVP は許容。
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
  return online;
}
