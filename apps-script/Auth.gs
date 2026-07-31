// ── Auth helpers ──

function hashPassword(password) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password, Utilities.Charset.UTF_8);
  return bytes.map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function requireSession(token) {
  var sess = getSession(token);
  if (!sess) throw new Error('Sesión expirada. Por favor, iniciá sesión nuevamente.');
  return sess;
}

function requireAdmin(token) {
  var sess = requireSession(token);
  if (sess.rol !== 'Admin') throw new Error('No tenés permisos de administrador.');
  return sess;
}

// Admin completo o AdminL (lectura). Permite ver listados administrativos sin poder modificar.
function requireAdminView(token) {
  var sess = requireSession(token);
  if (sess.rol !== 'Admin' && sess.rol !== 'AdminL') throw new Error('No tenés permisos de administrador.');
  return sess;
}

// ── Auth API ──

function hasUsers() {
  var ss = getSpreadsheet();
  if (!ss) return false;
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  return sheet !== null && sheet.getLastRow() > 1;
}

function login(username, password) {
  if (!username || !password) throw new Error('Ingresá usuario y contraseña.');
  username = username.trim().toLowerCase();
  var ss = getSpreadsheet();
  if (!ss) throw new Error('Sistema no configurado.');
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) throw new Error('No hay usuarios configurados.');
  ensureUserFotoColumn(sheet);

  var data = sheet.getDataRange().getValues();
  var fotoIdx = data[0].indexOf('FotoUrl');
  var user = null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === username) {
      user = {
        id: String(data[i][0]), username: String(data[i][1]), hash: String(data[i][2]),
        rol: String(data[i][3]), activo: String(data[i][5]),
        fotoUrl: fotoIdx !== -1 ? String(data[i][fotoIdx] || '') : ''
      };
      break;
    }
  }
  if (!user) throw new Error('Usuario o contraseña incorrectos.');
  if (user.activo !== 'true') throw new Error('Usuario desactivado. Contactá al administrador.');
  if (user.hash !== hashPassword(password)) throw new Error('Usuario o contraseña incorrectos.');

  // Se guarda en PropertiesService en vez de CacheService: CacheService
  // vence sí o sí a las 6h como máximo (no hay forma de pedirle más), y acá
  // queremos sesiones que en la práctica no venzan solas — 10 años, con
  // limpieza de las vencidas en cada login (ver cleanupExpiredSessions) para
  // no acumular propiedades para siempre.
  var token = Utilities.getUuid();
  var SESSION_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000; // 10 años
  var expires = new Date().getTime() + SESSION_TTL_MS;
  cleanupExpiredSessions();
  PropertiesService.getScriptProperties().setProperty(
    'sess_' + token,
    JSON.stringify({ userId: user.id, username: user.username, rol: user.rol, fotoUrl: user.fotoUrl, expires: expires })
  );
  return { token: token, username: user.username, rol: user.rol, fotoUrl: user.fotoUrl };
}

function logout(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('sess_' + token);
  return true;
}

function getSession(token) {
  if (!token) return null;
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('sess_' + token);
  if (!raw) return null;
  try {
    var sess = JSON.parse(raw);
    if (sess.expires < new Date().getTime()) {
      props.deleteProperty('sess_' + token);
      return null;
    }
    // Si el usuario fue desactivado (o borrado) después de haber iniciado
    // sesión, esto lo saca al toque en el próximo pedido — antes solo se
    // revisaba "activo" al momento de loguearse, así que desactivar a
    // alguien no le cortaba el acceso hasta que la sesión venciera sola.
    if (!isUserActiveById(sess.userId)) {
      props.deleteProperty('sess_' + token);
      return null;
    }
    return sess;
  } catch(e) { return null; }
}

// Recorre las propiedades de sesión (prefijo 'sess_') y borra las que ya
// vencieron. Se llama en cada login — PropertiesService tiene un tope de
// cantidad de propiedades guardadas (compartido con el resto de la config
// del script, como SPREADSHEET_ID), y como las sesiones ahora duran 10
// años en vez de expirar solas, sin esto se irían acumulando para siempre.
function cleanupExpiredSessions() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var now = new Date().getTime();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf('sess_') !== 0) return;
    try {
      var sess = JSON.parse(all[key]);
      if (sess.expires < now) props.deleteProperty(key);
    } catch (e) { props.deleteProperty(key); } // valor corrupto: se descarta
  });
}

// true si el usuario sigue existiendo y activo en la hoja Usuarios.
function isUserActiveById(userId) {
  var ss = getSpreadsheet();
  if (!ss) return false;
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return false;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(userId)) {
      return String(data[i][5]).toLowerCase() === 'true';
    }
  }
  return false; // usuario borrado
}

function createInitialAdmin(username, password) {
  if (hasUsers()) throw new Error('Ya existen usuarios. Usá el panel de administración.');
  username = (username || '').trim().toLowerCase();
  if (username.length < 3) throw new Error('El usuario debe tener al menos 3 caracteres.');
  if ((password || '').length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres.');
  var sheet = getOrCreateUsersSheet();
  var id = Utilities.getUuid().substring(0, 8).toUpperCase();
  var fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  sheet.appendRow([id, username, hashPassword(password), 'Admin', fecha, 'true']);
  sheet.getRange(sheet.getLastRow(), 1).setValue(id);
  return true;
}
