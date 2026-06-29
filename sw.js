// Service Worker — offline-ready PWA shell.
// Strategy: network-first for the app shell (so updates always reach the user),
// cache-only as the offline fallback. The map tiles need network anyway (Google).
const CACHE = 'garden-designer-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  // Wipe ALL old caches so stale CSS/JS from a previous version is purged.
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
  // Tell any open tabs to reload so they pick up the new shell immediately.
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) =>
      clients.forEach((c) => c.navigate(c.url))
    )
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Never intercept Google Maps / tile requests.
  if (req.url.includes('googleapis.com') || req.url.includes('gstatic.com') || req.url.includes('maps.gstatic')) {
    return;
  }
  // Only handle GET.
  if (req.method !== 'GET') return;

  // Network-first: try network for fresh content, fall back to cache when offline.
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
