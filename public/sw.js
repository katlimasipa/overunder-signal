const VERSION = "overunder-pwa-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const PAGE_CACHE = `${VERSION}-pages`;
const ASSET_CACHE = `${VERSION}-assets`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/favicon.png",
  "/brand/overunderauto-logo-on-light.png",
  "/brand/overunderauto-logo-on-dark.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key.startsWith("overunder-pwa-") && !key.startsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (
            response.ok &&
            url.pathname === "/" &&
            !url.search &&
            !response.headers.has("set-cookie")
          ) {
            const pages = await caches.open(PAGE_CACHE);
            await pages.put("/", response.clone());
          }
          return response;
        } catch {
          if (url.pathname === "/" && !url.search) {
            const cachedPage = await caches.open(PAGE_CACHE).then((cache) => cache.match("/"));
            if (cachedPage) return cachedPage;
          }
          return (await caches.match(OFFLINE_URL)) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (!["script", "style", "image", "font", "manifest"].includes(request.destination)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && !response.headers.has("set-cookie")) {
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
