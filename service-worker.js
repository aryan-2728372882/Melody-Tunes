// service-worker.js - Enhanced for Background Playback
const CACHE_NAME = 'melodytunes-v8';
const ASSETS = [
  '/',
  '/index.html',
  '/auth.html',
  '/manifest.json',
  '/styles/styles.css',
  '/scripts/player.js',
  '/scripts/app.js',
  '/scripts/firebase-config.js'
];

// Install - cache core assets
self.addEventListener('install', event => {
  console.log('🔧 Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Caching core assets');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('Cache failed:', err))
  );
});

// Activate - cleanup old caches
self.addEventListener('activate', event => {
  console.log('✅ Service Worker activated');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - serve cached or network
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // NEVER cache JSON files - always fetch fresh
  if (url.pathname.startsWith('/jsons/') || url.pathname.startsWith('/Jsons/')) {
    return event.respondWith(fetch(event.request));
  }

  // NEVER cache audio files
  if (url.pathname.endsWith('.mp3') || 
      url.pathname.endsWith('.m4a') || 
      url.pathname.endsWith('.wav') ||
      url.pathname.endsWith('.ogg')) {
    return event.respondWith(fetch(event.request));
  }

  // NEVER cache Firebase/API calls
  if (url.hostname.includes('firebase') || 
      url.hostname.includes('googleapis') ||
      url.hostname.includes('gstatic')) {
    return event.respondWith(fetch(event.request));
  }

  // Cache-first for assets
  if (ASSETS.includes(url.pathname) || url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          if (response) {
            return response;
          }
          return fetch(event.request).then(response => {
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseClone);
              });
            }
            return response;
          });
        })
    );
  }
});

// Message handling - keep service worker alive during playback
self.addEventListener('message', event => {
  console.log('💬 Message received:', event.data?.type);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  // Respond to keep-alive pings
  if (event.data && event.data.type === 'PLAYBACK_ACTIVE') {
    event.ports[0]?.postMessage({ 
      received: true, 
      timestamp: Date.now() 
    });
  }

  // Update playback state
  if (event.data && event.data.type === 'PLAYBACK_STATE') {
    console.log('🎵 Playback state:', event.data.state);
  }
});

// Periodic sync for keeping connection alive
self.addEventListener('periodicsync', event => {
  if (event.tag === 'background-sync') {
    console.log('🔄 Periodic sync triggered');
    event.waitUntil(syncPlaybackState());
  }
});

async function syncPlaybackState() {
  const clients = await self.clients.matchAll({ 
    type: 'window',
    includeUncontrolled: true 
  });
  
  clients.forEach(client => {
    client.postMessage({ 
      type: 'SYNC_CHECK',
      timestamp: Date.now()
    });
  });
}

// Push notification handling (for future features)
self.addEventListener('push', event => {
  console.log('🔔 Push notification received');
  const data = event.data?.json() ?? {};
  
  if (data.type === 'playback') {
    const options = {
      body: data.message || 'Playback notification',
      icon: '/assets/logo.png',
      badge: '/assets/logo.png',
      tag: 'playback-control',
      requireInteraction: false,
      silent: true
    };
    
    event.waitUntil(
      self.registration.showNotification(
        data.title || 'MelodyTunes', 
        options
      )
    );
  }
});

// Notification click - focus or open app
self.addEventListener('notificationclick', event => {
  console.log('🖱️ Notification clicked');
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ 
      type: 'window',
      includeUncontrolled: true 
    }).then(windowClients => {
      // Focus existing window
      for (let client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Background fetch for offline support (experimental)
self.addEventListener('backgroundfetchsuccess', event => {
  console.log('📥 Background fetch succeeded');
});

self.addEventListener('backgroundfetchfail', event => {
  console.log('❌ Background fetch failed');
});

// Sync event for offline queue
self.addEventListener('sync', event => {
  if (event.tag === 'sync-playback') {
    console.log('🔄 Sync event triggered');
    event.waitUntil(syncPlaybackState());
  }
});

console.log('🎵 MelodyTunes Service Worker loaded');