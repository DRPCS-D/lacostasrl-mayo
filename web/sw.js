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
// notaban.
//
// TIENE QUE COINCIDIR con APP_VERSION de js/version.js: 'v' + APP_VERSION.
// No es una convención cosmética — es lo que dispara la reinstalación del
// service worker, que es el ÚNICO camino por el que se rearma el caché
// (ver más abajo). scripts/check-version-sync.js lo verifica en el deploy y
// falla si se desfasan. Quedó desfasado tres releases (sw en v75 mientras
// APP_VERSION iba en 78) y ese fue el origen del bug de la vista trabada.
const CACHE_VERSION = 'v79';
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

// INVARIANTE: el caché se escribe SOLO en 'install', con un addAll() que es
// todo-o-nada. Acá abajo nunca se llama cache.put(). Es deliberado.
//
// Antes esto era stale-while-revalidate y cada archivo se revalidaba por su
// cuenta, con su propio fetch y su propio cache.put. Como no había atomicidad
// entre archivos, si el service worker moría antes de terminar todos (pasa
// seguido en celulares, y también al cerrar la PWA enseguida de abrirla) el
// caché quedaba con una MEZCLA de versiones: p. ej. index.html nuevo con
// app.js viejo. app.js pesa ~230 KB y version.js 400 bytes, así que el chico
// ganaba la carrera casi siempre y el chequeo de versión de app.js pasaba
// limpio comparando dos version.js nuevos, mientras el app.js viejo se
// estrellaba contra un DOM que ya no reconocía (getElementById devolvía null
// y switchSection/launchApp cortaban por TypeError: la app quedaba clavada en
// el panel que viene activo de fábrica en el HTML, respondiendo a los clics
// pero sin cambiar de vista).
//
// Sirviendo solo lo que dejó un addAll(), el caché es siempre una foto
// coherente de un único install. Si falta algo, va a la red.
self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return; // no interceptar POST a la API
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // no cachear CDN/API cross-origin

  // Pedidos con cache-buster: el chequeo de versión (js/version.js?_=…) y la
  // recarga forzada de "Actualizar app" (?_v=…). Tienen que ver la red sí o sí,
  // así que se dejan pasar sin tocar. Además, antes cada una de estas URLs
  // únicas se guardaba como una entrada nueva en el caché y no la borraba
  // nadie: una entrada basura por cada apertura de la app.
  if (url.searchParams.has('_') || url.searchParams.has('_v')) return;

  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).catch(function() {
        // Sin red y sin caché: si es una navegación, mostrar el shell guardado
        // en vez del error del navegador.
        return req.mode === 'navigate' ? caches.match('./index.html') : Response.error();
      });
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
