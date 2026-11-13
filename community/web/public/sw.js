/* Shroom Labs service worker: installability and a conservative offline shell.
   API traffic and live chamber data stay on the network and are never cached. */
const CACHE = "sl-pwa-v1";
const SHELL = [
  "/",
  "/devices",
  "/login",
  "/css/style.css",
  "/css/tokens.css",
  "/js/pwa.js",
  "/js/config.js",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/manifest.webmanifest",
];

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function isApiRequest(request, url) {
  if (url.hostname === "api.shroomlabs.io") return true;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return true;
  if (url.protocol === "ws:" || url.protocol === "wss:") return true;
  if (request.headers.has("authorization")) return true;
  return false;
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/css/") ||
    url.pathname.startsWith("/js/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/img/") ||
    url.pathname.startsWith("/og/") ||
    /\.(?:css|js|mjs|woff2|png|svg|jpg|jpeg|webp|ico)$/.test(url.pathname)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh.ok && fresh.type === "basic") {
      const cache = await caches.open(CACHE);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const hit = await caches.match(request);
    if (hit) return hit;
    const fallback = (await caches.match("/devices")) || (await caches.match("/")) || (await caches.match("/login"));
    if (fallback) return fallback;
    return new Response("You're offline. Check your connection and try again.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh.ok && fresh.type === "basic") {
    const cache = await caches.open(CACHE);
    cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isApiRequest(request, url)) return;
  if (!sameOrigin(url)) return;
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isStaticAsset(url)) event.respondWith(cacheFirst(request));
});
