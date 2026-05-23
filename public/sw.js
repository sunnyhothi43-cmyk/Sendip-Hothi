const CACHE_NAME = "chordstream-cache-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-512x512.png"
];

// Installs the service worker and caches core shell files
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Cleans up legacy caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Catches fetch events and serves from cache first, then network fallback
self.addEventListener("fetch", (event) => {
  // Only cache GET requests. Ignore API routes, third-party authentication endpoint, and Firestore calls to avoid interference.
  if (
    event.request.method !== "GET" || 
    event.request.url.includes("/api/") || 
    event.request.url.includes("firestore.googleapis.com") ||
    event.request.url.includes("identitytoolkit.googleapis.com") ||
    event.request.url.includes("firebase")
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Cache successful first-party static resource requests on-the-fly
        if (
          networkResponse && 
          networkResponse.status === 200 && 
          networkResponse.type === "basic" &&
          !event.request.url.includes("chrome-extension")
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // SPA Fallback for navigation requests when offline
        if (event.request.mode === "navigate") {
          return caches.match("/");
        }
      });
    })
  );
});
