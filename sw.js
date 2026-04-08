/**
 * Pulsetto Web Controller Service Worker
 * 
 * Provides offline capability and background handling for PWA.
 * Enhanced with keepalive support for Web Bluetooth connections.
 */

const CACHE_NAME = 'pulsetto-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/js/protocol.js',
  '/js/bluetooth.js',
  '/js/session-clock.js',
  '/js/background-keepalive.js',
  '/js/mode-engines.js',
  '/js/app.js',
  '/manifest.json',
  '/icon.svg'
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
  if (event.request.method !== 'GET') return;
  
  if (event.request.url.startsWith('chrome-extension://') ||
      event.request.url.startsWith('moz-extension://')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
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

// Background sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'session-sync') {
    event.waitUntil(syncSessionState());
  }
});

// Periodic background sync - for keepalive
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'keepalive') {
    event.waitUntil(handlePeriodicSync());
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Pulsetto', {
      body: data.body || 'Session active - keep tab visible',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: data.tag || 'pulsetto-keepalive',
      requireInteraction: true,
      silent: true,
      data: { type: 'keepalive', ...data.payload }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/').then((windowClient) => {
      if (windowClient) windowClient.focus();
    })
  );
});

// Message handling from main thread
self.addEventListener('message', (event) => {
  const { type } = event.data || {};
  
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (type === 'PING') {
    event.ports[0]?.postMessage({ type: 'PONG', timestamp: Date.now() });
  }
  
  if (type === 'KEEPALIVE_START') {
    // Main thread is starting keepalive
    console.log('[SW] Keepalive started');
  }
  
  if (type === 'KEEPALIVE_TICK') {
    // Received tick from main thread - keep SW alive
    broadcastToClients({ type: 'SW_ALIVE', timestamp: Date.now() });
  }
});

// Broadcast to all clients
function broadcastToClients(message) {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    clients.forEach((client) => {
      client.postMessage(message);
    });
  });
}

async function syncSessionState() {
  console.log('[SW] Background sync triggered');
}

async function handlePeriodicSync() {
  // Periodic sync - wake up to keep connection alive
  console.log('[SW] Periodic sync triggered');
  
  // Notify all clients to check connection
  broadcastToClients({ 
    type: 'PERIODIC_SYNC', 
    timestamp: Date.now(),
    message: 'Keepalive check from service worker'
  });
}
