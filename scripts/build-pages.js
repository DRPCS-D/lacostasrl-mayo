/**
 * Compila web/index.html (que usa <?!= include('archivo'); ?> como en Apps
 * Script) a un único docs/index.html estático, resolviendo cada include en
 * tiempo de build en vez de en tiempo de ejecución. Así el mismo código
 * fuente sirve tanto para el proyecto de Apps Script (si algún día se
 * quisiera volver a servir desde ahí) como para GitHub Pages.
 *
 * Uso: node scripts/build-pages.js
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
const OUT_DIR = path.join(__dirname, '..', 'docs');

function render(file, seen) {
  seen = seen || [];
  if (seen.indexOf(file) !== -1) {
    throw new Error('Include circular detectado: ' + seen.concat(file).join(' -> '));
  }
  const full = path.join(WEB, file);
  const raw = fs.readFileSync(full, 'utf8');
  return raw.replace(/<\?!= include\('([^']+)'\); ?\?>/g, function(match, name) {
    return render(name + '.html', seen.concat(file));
  });
}

const html = render('index.html');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '');

console.log('docs/index.html generado a partir de web/*.html (' + html.split(/\r?\n/).length + ' líneas)');
