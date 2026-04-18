"use client";

import { useEffect } from "react";

/**
 * Service Worker 登録コンポーネント (issue #24, docs/07 §7.5)。
 * Layout から 1 度だけ mount する。production ビルドでのみ register する
 * (開発中は HMR 干渉を避けるため)。
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
        // 登録失敗は致命的ではない (offline 機能が効かなくなるだけ)
        console.warn("SW registration failed", err);
      });
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
