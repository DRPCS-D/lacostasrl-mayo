// Única fuente de verdad para la versión del frontend. La lee tanto index.html
// (para mostrarla en el drawer) como sw.js (para nombrar el caché — ver abajo).
// Subir este número en cada release fuerza a los clientes con la PWA instalada
// a bajar el service worker nuevo (y con el botón "Actualizar" del drawer,
// a limpiar el caché viejo y recargar en el momento).
var APP_VERSION = '78';
