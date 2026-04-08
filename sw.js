// Commit: 5
const CACHE_NAME = 'walk-planner-v1.1.8';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './icon.png',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// Install: Cache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('SW: Pre-caching assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('SW: Clearing old cache');
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Stale-While-Revalidate strategy
self.addEventListener('fetch', (event) => {
  // Only handle GET requests for our cache
  if (event.request.method !== 'GET') return;

  // Bypass cache for external APIs (like Open-Meteo) so UI always gets fresh data
  if (event.request.url.includes('open-meteo.com')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Only cache valid successful responses
        if (networkResponse && networkResponse.status === 200) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
        }
        return networkResponse;
      }).catch(() => {
        // network failure, just return cached response if it exists
        return cachedResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});

// Push: Background notifications
self.addEventListener('push', (event) => {
  let title = 'Walk Planner Update';
  let options = {
    body: 'A walk is ready for you!',
    icon: 'icon.png',
    badge: 'icon.png'
  };

  if (event.data) {
    const data = event.data.json();
    title = data.title || title;
    options.body = data.body || options.body;
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click: Open app or existing tab
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('./');
    })
  );
});
