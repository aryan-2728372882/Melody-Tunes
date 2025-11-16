const CACHE = 'vibetunes-v7';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/styles/styles.css',
  '/scripts/player.js',
  '/scripts/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // JSON must ALWAYS load fresh
  if (url.pathname.startsWith('/Jsons/')) {
    return; // no caching
  }

  // App shell caching
  if (ASSETS.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
