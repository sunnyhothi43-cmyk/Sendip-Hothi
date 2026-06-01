const CACHE_NAME = "chordstream-cache-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-512x512.png"
];

// Detect if running on a development or preview environment
const isDevOrPreview = 
  self.location.hostname.includes("localhost") || 
  self.location.hostname.includes("ais-dev-") || 
  self.location.hostname.includes("ais-pre-");

// Installs the service worker and caches core shell files
self.addEventListener("install", (event) => {
  if (isDevOrPreview) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Cleans up legacy caches
self.addEventListener("activate", (event) => {
  if (isDevOrPreview) {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(cacheNames.map((cache) => caches.delete(cache)));
      }).then(() => {
        console.log("[SW] Cleared legacy cache inside SW.");
        return self.registration.unregister();
      }).then(() => {
        console.log("[SW] Unregistered inside SW.");
        return self.clients.claim();
      })
    );
    return;
  }
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
  if (isDevOrPreview) {
    return;
  }

  // Only cache GET requests. Ignore API routes, third-party authentication endpoint, Firestore, and development environments.
  if (
    event.request.method !== "GET" || 
    event.request.url.includes("/api/") || 
    event.request.url.includes("firestore.googleapis.com") ||
    event.request.url.includes("identitytoolkit.googleapis.com") ||
    event.request.url.includes("firebase") ||
    event.request.url.includes("localhost") ||
    event.request.url.includes("ais-dev-")
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
