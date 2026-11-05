// Offline cache for the Monatskasse web app. Not used inside the Android app (Capacitor serves the files itself).
const VERSION = "mk-1";
const SHELL = ["./", "styles.css", "app.js", "money.js", "parse.js", "orient.js", "vendor/xlsx.full.min.js", "manifest.webmanifest", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // OCR files never change under the same name: cache first, loaded on the first receipt scan. Everything else: network first, cache offline.
  const immutable = url.pathname.includes("/vendor/tess/");
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (immutable) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true })) || Response.error();
    }
  })());
});
