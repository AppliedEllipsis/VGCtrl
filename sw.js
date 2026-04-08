/**
 * Pulsetto Web Controller Service Worker
 * 
 * Provides offline capability and background handling for PWA.
 */

const CACHE_NAME = 'pulsetto-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/js/protocol.js',
  '/js/bluetooth.js',
  '/js/session-clock.js',
  '/js/mode-engines.js',
  '/js/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install: Cache static assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch((err) => console.error('Cache install failed:', err))
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  
  self.clients.claim();
});

// Fetch: Serve from cache or network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Skip browser extensions
  if (event.request.url.startsWith('chrome-extension://') ||
      event.request.url.startsWith('moz-extension://')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Return cached and fetch update in background
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, response);
              });
            }
          })
          .catch(() => {});
        
        return cached;
      }
      
      // Not in cache, fetch from network
      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          
          return response;
        })
        .catch((err) => {
          console.error('Fetch failed:', err);
          return new Response('Offline', { status: 503 });
        });
    })
  );
});

// Background sync for session state (when supported)
self.addEventListener('sync', (event) => {
  if (event.tag === 'session-sync') {
    event.waitUntil(syncSessionState());
  }
});

// Period background sync (for keepalive - Chrome only)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'keepalive') {
    event.waitUntil(handlePeriodicSync());
  }
});

// Push notifications (for session alerts)
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Pulsetto', {
      body: data.body || 'Session update',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'pulsetto',
      requireInteraction: data.requireInteraction || false,
      data: data.payload || {}
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/').then((windowClient) => {
      if (windowClient) {
        windowClient.focus();
      }
    })
  );
});

// Message handling from main thread
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data?.type === 'PING') {
    event.ports[0]?.postMessage({ type: 'PONG', timestamp: Date.now() });
  }
});

async function syncSessionState() {
  // Placeholder for session state sync
  console.log('Background sync triggered');
}

async function handlePeriodicSync() {
  // Placeholder for periodic background sync
  // This could be used for keepalive in future Chrome versions
  console.log('Periodic sync triggered');
}
