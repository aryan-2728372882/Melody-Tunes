// service-worker.js — MusicsAura 2025 - SCREEN OFF PLAYBACK FIX (CLEAN)
const CACHE_NAME = 'MusicsAuras-v14';
const CORE_ASSETS = ['/', '/index.html', '/auth.html', '/manifest.json', '/styles/styles.css', '/scripts/player.js', '/scripts/app.js', '/scripts/firebase-config.js', '/assets/logo.png'];

// FAST Dropbox URL fix
function fixDropboxUrl(url) {
  if (!url.includes('dropbox.com')) return url;
  
  // Already a direct link? Return as-is
  if (url.includes('dl.dropboxusercontent.com') && url.includes('raw=1')) {
    return url;
  }
  
  try {
    const u = new URL(url);
    if (u.hostname === 'www.dropbox.com') {
      u.hostname = 'dl.dropboxusercontent.com';
      if (!u.searchParams.has('raw')) {
        u.searchParams.set('raw', '1');
      }
      return u.toString();
    }
  } catch (e) {
    return url.replace('www.dropbox.com', 'dl.dropboxusercontent.com') + 
           (url.includes('?') ? '&raw=1' : '?raw=1');
  }
  
  return url;
}

// Install
self.addEventListener('install', e => {
  console.log('[SW] Installing...');
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate
self.addEventListener('activate', e => {
  console.log('[SW] Activated');
  e.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Fast fetch handler for audio
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // AUDIO FILES: Priority handling
  if (/\.(mp3|m4a|aac|wav|ogg|flac)($|\?)/i.test(url)) {
    event.respondWith(
      (async () => {
        try {
          // Try direct fetch first
          const response = await fetch(event.request, {
            credentials: 'omit',
            mode: 'cors',
            cache: 'no-cache',
            keepalive: true,
            priority: 'high'
          });
          
          if (response.ok) return response;
          throw new Error('Direct fetch failed');
        } catch (directError) {
          // Fallback to Dropbox fix
          const fixedUrl = fixDropboxUrl(url);
          
          if (fixedUrl !== url) {
            try {
              const fixedResponse = await fetch(fixedUrl, {
                credentials: 'omit',
                mode: 'cors',
                cache: 'no-cache',
                keepalive: true,
                priority: 'high'
              });
              
              if (fixedResponse.ok) return fixedResponse;
            } catch (fixedError) {
              // Continue to fallback
            }
          }
          
          // Last resort
          return fetch(event.request);
        }
      })()
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
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) {
        fetchAndCache(event.request); // Background update
        return cached;
      }
      
      const response = await fetch(event.request);
      
      if (response.status === 200 && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      
      return response;
    })()
  );
});

// Background cache update
async function fetchAndCache(request) {
  try {
    const response = await fetch(request);
    if (response.status === 200 && response.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response);
    }
  } catch (err) {
    // Silent fail
  }
}

// Message handling
let keepAliveTimer = null;
let lastKeepAlive = Date.now();
let currentSong = null;

self.addEventListener('message', event => {
  const data = event.data;
  
  if (data?.type === 'KEEP_ALIVE') {
    lastKeepAlive = Date.now();
    
    // Only log song changes
    if (data.playing && data.song && currentSong !== data.song) {
      currentSong = data.song;
      console.log(`[SW] Playing: ${data.song}`);
    }
    
    clearTimeout(keepAliveTimer);
    keepAliveTimer = setTimeout(() => {}, 2147483647);
    
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ 
        alive: true, 
        timestamp: Date.now()
      });
    }
  }
  
  if (data?.type === 'HEARTBEAT' || data?.type === 'BACKGROUND_PING') {
    lastKeepAlive = Date.now();
  }
  
  if (data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (data?.type === 'PRELOAD_AUDIO' && data.url) {
    fetch(data.url, { 
      mode: 'cors',
      priority: 'low',
      credentials: 'omit'
    }).catch(() => {});
  }
});

// Heartbeat to keep SW alive
setInterval(() => {
  const now = Date.now();
  if (now - lastKeepAlive < 30000) {
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
      .then(clients => {
        if (clients.length > 0) {
          clients[0].postMessage({ 
            type: 'SW_HEARTBEAT',
            timestamp: now
          });
        }
      });
  }
}, 15000);

// Keep service worker alive
function keepAlive() {
  setTimeout(keepAlive, 10000);
}
keepAlive();

// Error handling
self.addEventListener('error', event => {
  console.error('[SW] Error:', event.error);
});

self.addEventListener('unhandledrejection', event => {
  console.error('[SW] Unhandled Rejection:', event.reason);
});

console.log('[SW] MusicsAura v14 Ready');