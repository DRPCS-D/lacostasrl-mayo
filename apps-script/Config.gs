const SHEET_NAME = 'Pedidos';
const USERS_SHEET_NAME = 'Usuarios';
const CLIENTS_SHEET_NAME = 'Clientes';
const INFORMES_SHEET_NAME = 'Informes';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o';

/**
 * Este proyecto ya no sirve la interfaz: el frontend vive en GitHub Pages
 * (carpeta web/ del repo) y le habla a este Web App como API JSON vía
 * doPost(). Ver Api.gs.
 */
function doGet() {
  return ContentService.createTextOutput(
    'API de LA COSTA S.R.L.\n' +
    'Este endpoint es el backend (JSON vía POST). El frontend se sirve desde GitHub Pages.'
  ).setMimeType(ContentService.MimeType.TEXT);
}

// ── Idempotencia de guardado (Pedidos / Informes) ──
// Con señal débil, google.script.run puede no devolver nunca la respuesta
// aunque el guardado sí haya llegado al backend (ver armSaveTimeout en
// app.js): el usuario no ve confirmación, y si reintenta ("Guardar" de
// nuevo) sin esto se agrega una fila duplicada.
// La clave se arma con el contenido real del guardado, no con un ID que
// genere el cliente: un reintento del mismo clic manda exactamente los
// mismos valores y cae en la misma clave. Si el usuario edita algo antes de
// reintentar, la clave cambia sola y el guardado se hace normalmente.
var SAVE_DEDUPE_TTL_SEC = 120;

function checkSaveDedupe_(scope, parts) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts.join('|'));
  var key = 'save_' + scope + '_' + Utilities.base64EncodeWebSafe(digest);
  var cache = CacheService.getScriptCache();
  var cached = cache.get(key);
  return { key: key, cache: cache, result: cached ? JSON.parse(cached) : null };
}

function rememberSaveDedupe_(entry, result) {
  entry.cache.put(entry.key, JSON.stringify(result), SAVE_DEDUPE_TTL_SEC);
}
