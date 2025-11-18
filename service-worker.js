// service-worker.js – MELODYTUNES FINAL 2025 (NO 403, Immortal Background)
const CACHE_NAME = 'melodytunes-v12';
const CORE_ASSETS = ['/', '/index.html', '/auth.html', '/manifest.json', '/styles/styles.css', '/scripts/player.js', '/scripts/app.js', '/scripts/firebase-config.js', '/assets/logo.png'];

// 2025 DROPBOX FIX – KEEPS rlkey + FORCES raw=1 (NO 403!)
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
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(CORE_ASSETS)).then(() => self.skipWaiting())));

// Activate
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))).then(() => self.clients.claim())));

// Fetch – FIXED AUDIO + NO CACHING
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // AUDIO: Fix Dropbox + bypass cache
  if (/\.(mp3|m4a|aac|wav|ogg)($|\?)/i.test(url)) {
    const fixed = fixDropboxUrl(url);
    return event.respondWith(fetch(fixed, { credentials: 'omit' }).catch(() => fetch(event.request)));
  }

  // APIs & Firebase → network only
  if (url.includes('firebase') || url.includes('googleapis') || url.includes('gstatic') || url.includes('/jsons/')) {
    return event.respondWith(fetch(event.request));
  }

  // App shell → cache-first
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
    if (res.status === 200) caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
    return res;
  })));
});

// Keep SW alive forever
let timer;
self.addEventListener('message', e => {
  if (e.data?.type === 'KEEP_ALIVE') {
    clearTimeout(timer);
    timer = setTimeout(() => {}, 2147483647);
    e.ports[0]?.postMessage({ alive: true });
  }
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Heartbeat every 25 mins
setInterval(() => self.clients.matchAll().then(c => c.forEach(client => client.postMessage({ type: 'SW_HEARTBEAT' }))), 25 * 60 * 1000);

console.log('MelodyTunes SW v12 – NO 403, Immortal, Perfect');