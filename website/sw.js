/* ZheshGo service worker — v1
   Cache strategy:
   - app shell (core html/css/js/assets): precached, cache-first
   - page navigations (html): network-first, fall back to cached copy,
     then offline.html
   - content data (js/data/content.js): network-first, fall back to cache
   Bump CACHE_VERSION when content changes.
*/
const CACHE_VERSION = "zheshgo-v4-qwen-network-20261013";
const PRECACHE = [
  "index.html",
  "explore.html",
  "city.html",
  "route.html",
  "place.html",
  "planner.html",
  "my-trip.html",
  "assistant.html",
  "consult.html",
  "community.html",
  "faq.html",
  "about.html",
  "privacy.html",
  "events.html",
  "offline.html",
  "404.html",
  "css/styles.css",
  "js/app.js",
  "js/config.js",
  "js/assistant.js",
  "js/data/content.js",
  "manifest.webmanifest",
  "favicon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "assets/img/brand-mark.svg",
  "assets/img/hero-art.svg",
  "assets/img/city-shanghai.svg",
  "assets/img/city-hangzhou.svg",
  "assets/img/city-ningbo.svg",
  "assets/img/city-shaoxing.svg",
  "assets/img/city-zhoushan.svg",
  "assets/img/theme-architecture.svg",
  "assets/img/theme-food.svg",
  "assets/img/theme-buddhist.svg",
  "assets/img/theme-port.svg",
  "assets/img/theme-walk.svg",
  "assets/img/theme-family.svg",
  "assets/img/theme-slow.svg",
  "assets/img/sample-ticket-machine.svg",
  "assets/img/sample-locker.svg",
  "assets/img/sample-kiosk.svg",
  "assets/img/sample-menu.svg",
  "assets/img/sample-signage.svg",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_VERSION; }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isPage = req.mode === "navigate";
  const isContentData = url.pathname.endsWith("/js/data/content.js");

  if (isPage) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
          }
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (cached) {
            return cached || caches.match("offline.html");
          });
        })
    );
    return;
  }

  if (isContentData) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
          }
          return res;
        })
        .catch(function () { return caches.match(req); })
    );
    return;
  }

  // static assets: cache-first
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
