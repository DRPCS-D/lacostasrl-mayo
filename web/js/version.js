// Única fuente de verdad para la versión del frontend. La lee index.html para
// mostrarla en el drawer, y el chequeo de arranque (checkForNewVersion en
// app.js) la compara contra la publicada para detectar código viejo.
//
// Al subir este número hay que subir TAMBIÉN CACHE_VERSION en web/sw.js, que
// debe quedar en 'v' + este valor. sw.js no lee este archivo: necesita el
// literal adentro para que el navegador vea cambiar sus bytes y reinstale el
// service worker (lo que rearma el caché del app shell). Si se desfasan, los
// usuarios con la PWA instalada quedan con archivos viejos.
// scripts/check-version-sync.js lo verifica en el deploy.
var APP_VERSION = '79';
