/* Tanren PWA Service Worker (issue #24)
 *
 * docs/07 §7.5 参照。MVP は以下のみ実装:
 *   - App Shell (/, /drill, /custom, /insights など) を Cache-First で配信
 *   - API (/api/*) は Network-First、オフライン時に最後のキャッシュを返す (ベストエフォート)
 *   - Web Push / Background Sync は未実装 (Phase 5+)
 *
 * キャッシュ命名は version をインクリメントして古い cache を即座に削除できるように。
 * 静的アセット (画像/フォント) の網羅性は意図的に最小にして、誤キャッシュで
 * スタイル崩れが起きたときに version up 1 回で直せる設計。
 */

const CACHE_VERSION = "v1";
const STATIC_CACHE = `tanren-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `tanren-runtime-${CACHE_VERSION}`;

const APP_SHELL = ["/", "/drill", "/custom", "/insights", "/review", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n !== STATIC_CACHE && n !== RUNTIME_CACHE)
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API: Network-First (オフライン時は最後の GET キャッシュ)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 認証関連はキャッシュしない
  if (url.pathname.startsWith("/login")) return;

  // App Shell + その他 GET: Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}
