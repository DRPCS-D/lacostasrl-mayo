// ────────────────────────────────────────────
// Service Worker — app shell cacheado, API/CDN sin tocar
// ────────────────────────────────────────────
// Solo cachea los archivos propios de la app (mismo origen, GET). Las
// llamadas a la API (POST a script.google.com) y los scripts de CDN
// (pdf.js, heic2any) nunca se interceptan: necesitan ir siempre a la red.
// Subir CACHE_NAME invalida el caché viejo en el próximo activate.
const CACHE_NAME = 'pedidos-lacosta-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/api.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(APP_SHELL); })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
      })
      .then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return; // no interceptar POST a la API
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // no cachear CDN/API cross-origin

  // Stale-while-revalidate: responde con el caché al toque si existe,
  // y en paralelo pide a la red para tener la versión más nueva la próxima vez.
  event.respondWith(
    caches.match(req).then(function(cached) {
      var fetchPromise = fetch(req).then(function(networkRes) {
        if (networkRes && networkRes.ok) {
          var copy = networkRes.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
        }
        return networkRes;
      }).catch(function() { return cached; });
      return cached || fetchPromise;
    })
  );
});
