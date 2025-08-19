const CACHE = 'pos-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  // Network-first para JSON/ventas, cache-first para estáticos
  if (request.url.endsWith('.json')) {
    e.respondWith(
      fetch(request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(request, clone));
        return resp;
      }).catch(()=>caches.match(request))
    );
  } else {
    e.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
  }
});
