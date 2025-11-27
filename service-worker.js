// service-worker.js — MELODYTUNES 2025 - SCREEN OFF PLAYBACK FIX (CLEAN LOGS: 1 LINE PER SONG)
const CACHE_NAME = 'melodytunes-v13';
const CORE_ASSETS = ['/', '/index.html', '/auth.html', '/manifest.json', '/styles/styles.css', '/scripts/player.js', '/scripts/app.js', '/scripts/firebase-config.js', '/assets/logo.png'];

// 2025 DROPBOX FIX — KEEPS rlkey + FORCES raw=1
function fixDropboxUrl(url) {
  if (!url.includes('dropbox.com')) return url;
  try {
    const u = new URL(url);
    if (u.hostname === 'www.dropbox.com') {
      u.hostname = 'dl.dropboxusercontent.com';
      u.searchParams.set('raw', '1');
      return u.toString();
    }
  } catch (e) {}
  return url + (url.includes('?') ? '&raw=1' : '?raw=1');
}

// Install
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// CRITICAL: Enhanced fetch handler for audio
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // AUDIO FILES: Critical for background playback
  if (/\.(mp3|m4a|aac|wav|ogg)($|\?)/i.test(url)) {
    const fixed = fixDropboxUrl(url);
    event.respondWith(
      fetch(fixed, { 
        credentials: 'omit',
        mode: 'cors',
        cache: 'default',
        keepalive: true
      })
      .then(response => response.ok ? response : fetch(event.request, { keepalive: true }))
      .catch(() => fetch(event.request, { keepalive: true }).catch(() => new Response(null, { status: 404 })))
    );
    return;
  }

  // APIs & Firebase → network only
  if (url.includes('firebase') || url.includes('googleapis') || url.includes('gstatic') || url.includes('/jsons/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // App shell → cache-first
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request).then(res => {
        if (res.status === 200) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        }
        return res;
      }))
  );
});

// ENHANCED: Message handling — ONE LOG PER SONG ONLY
let keepAliveTimer = null;
let lastKeepAlive = Date.now();
let currentSong = null; // Track current song to avoid duplicate logs

self.addEventListener('message', event => {
  const data = event.data;

  // KEEP_ALIVE: Triggered when song starts playing
  if (data?.type === 'KEEP_ALIVE' && data.playing && data.song) {
    lastKeepAlive = Date.now();

    // LOG EXACTLY ONCE PER SONG (only on change)
    if (currentSong !== data.song) {
      currentSong = data.song;
      console.log(`%cSW: Keeping alive for → ${data.song}`, 'color: #4CAF50; font-weight: bold; font-size: 12px;');
    }

    // Reset max-duration timer to keep SW alive
    clearTimeout(keepAliveTimer);
    keepAliveTimer = setTimeout(() => {}, 2147483647); // 2^31-1 ms ≈ 24.8 days

    // Confirm to player
    event.ports?.[0]?.postMessage({ alive: true, timestamp: Date.now() });
  }

  // HEARTBEAT / BACKGROUND_PING: Silent keep-alive pulses
  if (data?.type === 'HEARTBEAT' || data?.type === 'BACKGROUND_PING') {
    lastKeepAlive = Date.now();
  }

  // SKIP_WAITING: For instant updates
  if (data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// REMOVED: Noisy 20-second SW_HEARTBEAT broadcaster (was spamming console)
// → Deleted to eliminate all repeated logs and performance overhead

// Additional keepalive loop — prevents SW termination
let wakeLockTimer;
function preventTermination() {
  clearTimeout(wakeLockTimer);
  wakeLockTimer = setTimeout(preventTermination, 10000);
}
preventTermination();

// Handle background sync (future)
self.addEventListener('sync', event => {});

// Handle push notifications (future)
self.addEventListener('push', event => {});

// Graceful error handling (silent)
self.addEventListener('error', () => {});
self.addEventListener('unhandledrejection', () => {});

console.log('MelodyTunes SW v13 — CLEAN LOGS + SCREEN OFF PLAYBACK OPTIMIZED');