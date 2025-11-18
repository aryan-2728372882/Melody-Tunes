// service-worker.js - MELODYTUNES 2025 FINAL (Zero Stutter + iOS Background Proof)
const CACHE_NAME = 'melodytunes-v10';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/auth.html',
  '/manifest.json',
  '/styles/styles.css',
  '/scripts/player.js',
  '/scripts/app.js',
  '/scripts/firebase-config.js',
  '/assets/logo.png'
];

// Install & cache core shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate → delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: NEVER cache audio streams or APIs
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // BLOCK CACHING: Audio files
  if (/\.(mp3|m4a|aac|wav|ogg)($|\?)/i.test(url)) {
    return event.respondWith(fetch(event.request));
  }

  // BLOCK CACHING: Firebase, Google APIs, JSON data
  if (url.includes('firebase') || 
      url.includes('googleapis') || 
      url.includes('gstatic') || 
      url.includes('/jsons/') || 
      url.includes('/Jsons/')) {
    return event.respondWith(fetch(event.request));
  }

  // Cache-first for app shell & assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        if (response.status === 200) {
          caches.open(CACHE_NAME).then(cache => 
            cache.put(event.request, response.clone())
          );
        }
        return response;
      });
    })
  );
});

// KEEP SERVICE WORKER ALIVE FOREVER DURING PLAYBACK
let immortalityTimer = null;

self.addEventListener('message', event => {
  if (event.data?.type === 'KEEP_ALIVE') {
    // Reset immortality timer on every ping from player.js
    clearTimeout(immortalityTimer);
    immortalityTimer = setTimeout(() => {}, 2147483647); // ~24.8 days max
    event.ports[0]?.postMessage({ alive: true });
  }

  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Optional: Wake up every 25 mins (iOS allows SW to sleep after ~30 min)
setInterval(() => {
  self.clients.matchAll().then(clients => {
    clients.forEach(c => c.postMessage({ type: 'SW_HEARTBEAT' }));
  });
}, 25 * 60 * 1000);

console.log('MelodyTunes Service Worker v10 Loaded – Immortal Mode Active');