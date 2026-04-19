/* Tanren PWA Service Worker (issue #24)
 *
 * 設計方針:
 *   1. credentialed / 個人データが絡むレスポンスはキャッシュしない。
 *      → tRPC (/api/trpc/*) および HTML (Next.js App Router の SSR) はキャッシュ対象外。
 *   2. キャッシュするのは「どのユーザーでも同じ」static asset のみ:
 *      /manifest.webmanifest, /icon-*.png, /_next/static/* (Next のハッシュ付き静的資産)。
 *   3. APP_SHELL の precache は /manifest.webmanifest と /icon.png のみ。保護ルート
 *      (/drill, /custom, /insights, /review) は install 時にアクセスすると未ログイン端末で
 *      /login にリダイレクトされ、それがそのまま「保護ルートの shell」として precache
 *      されてしまうため含めない (Codex Round 1 指摘 A1)。
 *   4. cache.addAll を使わず個別 put + allSettled で install を壊れにくくする。
 *   5. Web Push / Background Sync は Phase 5+。
 *
 * version up: CACHE_VERSION を bump すると activate 時に旧 cache が一括削除される。
 */

const CACHE_VERSION = "v2";
const STATIC_CACHE = `tanren-static-${CACHE_VERSION}`;

/** install 時に precache する完全 static なもの (個人データなし、全ユーザー共通) */
const PRECACHE_URLS = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // cache.addAll は all-or-nothing で 1 つ失敗すると install 全体が落ちるため、
      // allSettled + put でベストエフォートに。
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const res = await fetch(url, { credentials: "omit" });
          if (res.ok) await cache.put(url, res);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== STATIC_CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 認証・HTML・API は絶対にキャッシュしない (credentialed レスポンスの残留防止)。
  // /api/*, /login, その他 HTML navigation は SW をバイパスしてブラウザのデフォルトに任せる。
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/login") return;
  if (request.mode === "navigate") return; // ドキュメント遷移は常にネットワーク

  // 完全 static なもののみ cache-first (Next のハッシュ付き資産 + 自前アセット):
  //   /_next/static/* (Content-Hash 付きなので stale にならない)
  //   /icon-*.png, /manifest.webmanifest, /favicon.ico
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico"
  ) {
    event.respondWith(cacheFirst(request));
  }
  // それ以外の GET は SW 介入なし (ブラウザの通常挙動)
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // cache.put を待ってから返すことで、レスポンス直後の SW 終了による書き込み欠損を防ぐ
  // (Codex Round 2 指摘: await/waitUntil なしは Cache-First が不安定)
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

// Web Push (issue #37): push 受信 → notification を表示
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Tanren", body: event.data.text() };
  }
  const title = payload.title || "Tanren";
  const options = {
    body: payload.body ?? "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url ?? "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知タップ時にアプリを開く
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.endsWith(url) && "focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
