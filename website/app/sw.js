/* ZheshGo service worker — v1
   Cache strategy:
   - app shell (core css/js/assets): precached, cache-first
   - page navigations (html): network-first, fall back to cached copy,
     then offline.html
   - language routing and content data: network-first, fall back to cache
   Bump CACHE_VERSION when content changes.
*/
const CACHE_PREFIX = "zheshgo-root-app-";
const CACHE_VERSION = CACHE_PREFIX + "zg001-cited-sources-20261017";
const PRECACHE = [
  "../css/i18n.css",
  "../js/i18n-route.js",
  "index.html",
  "explore.html",
  "city.html",
  "route.html",
  "place.html",
  "planner.html",
  "my-trip.html",
  "assistant.html",
  "consult.html",
  "photo-guide.html",
  "community.html",
  "faq.html",
  "about.html",
  "privacy.html",
  "events.html",
  "offline.html",
  "404.html",
  "../css/styles.css",
  "../js/app.js",
  "../js/config.js",
  "../js/assistant.js",
  "../js/data/content.js",
  "manifest.webmanifest",
  "../favicon.svg",
  "../icons/icon-192.png",
  "../icons/icon-512.png",
  "../assets/img/brand-mark.svg",
  "../assets/img/hero-art.svg",
  "../assets/img/city-shanghai.svg",
  "../assets/img/city-hangzhou.svg",
  "../assets/img/city-ningbo.svg",
  "../assets/img/city-shaoxing.svg",
  "../assets/img/city-zhoushan.svg",
  "../assets/img/theme-architecture.svg",
  "../assets/img/theme-food.svg",
  "../assets/img/theme-buddhist.svg",
  "../assets/img/theme-port.svg",
  "../assets/img/theme-walk.svg",
  "../assets/img/theme-family.svg",
  "../assets/img/theme-slow.svg",
  "../assets/img/sample-ticket-machine.svg",
  "../assets/img/sample-locker.svg",
  "../assets/img/sample-kiosk.svg",
  "../assets/img/sample-menu.svg",
  "../assets/img/sample-signage.svg",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(PRECACHE.map(function (url) {
        return new Request(url, { cache: "reload" });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  let replacingOlderWorker = false;
  event.waitUntil(
    caches.keys().then(function (keys) {
      replacingOlderWorker = keys.some(function (k) { return k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION; });
      return Promise.all(
        keys.filter(function (k) { return k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION; }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); }).then(function () {
      if (!replacingOlderWorker) return;
      return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
        const scope = new URL(self.registration.scope);
        clients.filter(function (client) {
          const url = new URL(client.url);
          return client.visibilityState === "visible" && url.origin === scope.origin &&
            (url.pathname === scope.pathname || url.pathname === scope.pathname + "index.html");
        }).forEach(function (client) { client.navigate(client.url).catch(function () {}); });
      });
    })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  const isPage = req.mode === "navigate";
  const isContentData = url.pathname.endsWith("/js/data/content.js");
  const isLanguageRouting = url.pathname.endsWith("/js/i18n-route.js");

  if (isPage) {
    event.respondWith(
      fetch(req, { cache: "no-store" })
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

  if (isContentData || isLanguageRouting) {
    event.respondWith(
      fetch(req, isLanguageRouting ? { cache: "no-store" } : undefined)
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
