// Verifica que CACHE_VERSION (web/sw.js) y APP_VERSION (web/js/version.js)
// estén sincronizados: CACHE_VERSION tiene que ser 'v' + APP_VERSION.
//
// Por qué importa: el navegador decide si reinstala el service worker
// comparando los BYTES de sw.js. Si CACHE_VERSION no cambia, sw.js queda
// idéntico, no hay reinstalación, y no corre el install/addAll() — que es el
// único camino por el que se rearma el caché del app shell. Los usuarios con
// la PWA instalada se quedan con los archivos viejos hasta que alguien toque
// "Actualizar app" a mano.
//
// Pasó de verdad: sw.js quedó en v75 mientras APP_VERSION avanzó a 78, y de
// ahí salió el bug de la app trabada en la vista de Pedidos.
//
// Corre en el workflow de deploy (.github/workflows/deploy-pages.yml).
// Para correrlo a mano:  node scripts/check-version-sync.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const versionFile = path.join(root, 'web', 'js', 'version.js');
const swFile = path.join(root, 'web', 'sw.js');

function extract(file, regex, label) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(regex);
  if (!m) {
    console.error('ERROR: no se encontró ' + label + ' en ' + path.relative(root, file));
    process.exit(1);
  }
  return m[1];
}

const appVersion = extract(versionFile, /APP_VERSION\s*=\s*['"]([^'"]+)['"]/, 'APP_VERSION');
const cacheVersion = extract(swFile, /CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/, 'CACHE_VERSION');
const expected = 'v' + appVersion;

if (cacheVersion !== expected) {
  console.error('');
  console.error('  Las versiones están desfasadas:');
  console.error('');
  console.error('    web/js/version.js   APP_VERSION   = ' + JSON.stringify(appVersion));
  console.error('    web/sw.js           CACHE_VERSION = ' + JSON.stringify(cacheVersion));
  console.error('');
  console.error('  CACHE_VERSION tiene que ser ' + JSON.stringify(expected) + '.');
  console.error('  Sin eso el service worker no se reinstala y los usuarios con la PWA');
  console.error('  instalada se quedan con los archivos viejos.');
  console.error('');
  process.exit(1);
}

console.log('Versiones sincronizadas: APP_VERSION=' + appVersion + ', CACHE_VERSION=' + cacheVersion);
