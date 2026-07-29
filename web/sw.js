// ────────────────────────────────────────────
// Service Worker — app shell cacheado, API/CDN sin tocar
// ────────────────────────────────────────────
// Solo cachea los archivos propios de la app (mismo origen, GET). Las
// llamadas a la API (POST a script.google.com) y los scripts de CDN
// (pdf.js, heic2any) nunca se interceptan: necesitan ir siempre a la red.
//
// CACHE_VERSION vive ACÁ como literal (no en un archivo aparte importado,
// como estaba antes con js/version.js vía importScripts). El navegador
// detecta de forma confiable cuándo ESTE archivo cambió de bytes para
// decidir si hay que reinstalar el service worker; detectar cambios solo
// en un script que este archivo importa es mucho menos confiable — así se
// veían actualizaciones que tardaban en notarse o directamente no se
// notaban. Subir este número en cada deploy (igual que APP_VERSION en
// js/version.js — son dos números independientes, no hace falta que
// coincidan, pero conviene subir los dos juntos para no confundirse).
const CACHE_VERSION = 'v49';
const CACHE_NAME = 'pedidos-lacosta-' + CACHE_VERSION;
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/version.js',
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

// La página, al detectar que este SW nuevo quedó "installed" con el viejo
// todavía controlando, le pide que se active de una — ver activateNewSwAndReload_
// en app.js. (skipWaiting() ya se llama solo en 'install' arriba; esto es un
// empujón explícito para el flujo de recarga controlada, no estrictamente
// necesario pero no hace daño tenerlo.)
self.addEventListener('message', function(event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
