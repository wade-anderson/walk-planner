// Commit: 7
const CACHE_NAME = 'walk-planner-v1.5.0';
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
            console.log('SW: Clearing old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Network-First for code (HTML/JS), cache-first with revalidate for other assets, bypass external APIs
self.addEventListener('fetch', (event) => {
  // Only handle GET requests for our cache
  if (event.request.method !== 'GET') return;

  // Bypass cache for external APIs (like Open-Meteo) so UI always gets fresh data
  if (event.request.url.includes('open-meteo.com')) return;

  const url = new URL(event.request.url);

  // Never cache the app's own data API (walks/settings live on the server)
  if (url.pathname.includes('/api/')) return;

  const isCode = url.pathname.endsWith('.js') || url.pathname.endsWith('.html') || url.pathname.endsWith('/');

  if (isCode) {
    // Network-First with cache fallback for code files
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Stale-While-Revalidate for other static assets
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse.clone());
              });
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  }
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
