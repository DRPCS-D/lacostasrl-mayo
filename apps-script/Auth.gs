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

  var data = sheet.getDataRange().getValues();
  var user = null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === username) {
      user = { id: String(data[i][0]), username: String(data[i][1]), hash: String(data[i][2]), rol: String(data[i][3]), activo: String(data[i][5]) };
      break;
    }
  }
  if (!user) throw new Error('Usuario o contraseña incorrectos.');
  if (user.activo !== 'true') throw new Error('Usuario desactivado. Contactá al administrador.');
  if (user.hash !== hashPassword(password)) throw new Error('Usuario o contraseña incorrectos.');

  var token = Utilities.getUuid();
  var expires = new Date().getTime() + 4 * 60 * 60 * 1000;
  CacheService.getScriptCache().put(
    'sess_' + token,
    JSON.stringify({ userId: user.id, username: user.username, rol: user.rol, expires: expires }),
    14400
  );
  return { token: token, username: user.username, rol: user.rol };
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return true;
}

function getSession(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) return null;
  try {
    var sess = JSON.parse(raw);
    if (sess.expires < new Date().getTime()) {
      CacheService.getScriptCache().remove('sess_' + token);
      return null;
    }
    return sess;
  } catch(e) { return null; }
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
