// ── User Management (Admin only) ──

function listUsers(token) {
  requireAdminView(token);
  var ss = getSpreadsheet();
  if (!ss) return [];
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data = sheet.getDataRange().getDisplayValues();
  var headers = data[0];
  var fotoIdx = headers.indexOf('FotoUrl');
  return data.slice(1).map(function(row) {
    return {
      id: row[0], username: row[1], rol: row[3], fechaCreacion: row[4],
      activo: String(row[5]).toLowerCase(),
      fotoUrl: fotoIdx !== -1 ? (row[fotoIdx] || '') : ''
    };
  });
}

// { username en minúsculas → FotoUrl }, para pintar el avatar de cada
// vendedor en el mapa de Informes sin tener que exponer listUsers() a todos.
function getUserPhotoMap() {
  var map = {};
  var ss = getSpreadsheet();
  if (!ss) return map;
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return map;
  var data = sheet.getDataRange().getDisplayValues();
  var headers = data[0];
  var userIdx = headers.indexOf('Username');
  var fotoIdx = headers.indexOf('FotoUrl');
  if (userIdx === -1 || fotoIdx === -1) return map;
  data.slice(1).forEach(function(row) {
    var u = String(row[userIdx] || '').trim().toLowerCase();
    if (u) map[u] = row[fotoIdx] || '';
  });
  return map;
}

function createUser(token, userData) {
  requireAdmin(token);
  var username = (userData.username || '').trim().toLowerCase();
  var password = userData.password || '';
  var rol = (userData.rol === 'Admin' || userData.rol === 'AdminL') ? userData.rol : 'User';
  if (username.length < 3) throw new Error('El usuario debe tener al menos 3 caracteres.');
  if (password.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres.');
  var sheet = getOrCreateUsersSheet();
  var existing = sheet.getDataRange().getValues();
  for (var i = 1; i < existing.length; i++) {
    if (String(existing[i][1]).toLowerCase() === username) throw new Error('El usuario "' + username + '" ya existe.');
  }
  var fotoUrl = '';
  if (userData.fotoBase64 && userData.fotoMime) {
    fotoUrl = saveUserPhotoToDrive(userData.fotoBase64, userData.fotoMime, username);
  }
  var id = Utilities.getUuid().substring(0, 8).toUpperCase();
  var fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  sheet.appendRow([id, username, hashPassword(password), rol, fecha, 'true', fotoUrl]);
  sheet.getRange(sheet.getLastRow(), 1).setValue(id);
  return { success: true };
}

function updateUser(token, userId, userData) {
  requireAdmin(token);
  var ss = getSpreadsheet();
  if (!ss) throw new Error('Sin datos.');
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) throw new Error('Sin hoja de usuarios.');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var fotoIdx = headers.indexOf('FotoUrl');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(userId)) {
      var username = (userData.username || '').trim().toLowerCase() || String(data[i][1]);
      var hash = (userData.password && userData.password.length >= 4) ? hashPassword(userData.password) : String(data[i][2]);
      var rol = (userData.rol === 'Admin' || userData.rol === 'AdminL') ? userData.rol : 'User';
      var activo = (userData.activo === false || userData.activo === 'false') ? 'false' : 'true';
      sheet.getRange(i + 1, 2, 1, 5).setValues([[username, hash, rol, String(data[i][4]), activo]]);
      if (fotoIdx !== -1) {
        var fotoUrl = String(data[i][fotoIdx] || '');
        if (userData.fotoBase64 && userData.fotoMime) {
          fotoUrl = saveUserPhotoToDrive(userData.fotoBase64, userData.fotoMime, username);
        } else if (userData.removeFoto) {
          fotoUrl = '';
        }
        sheet.getRange(i + 1, fotoIdx + 1).setValue(fotoUrl);
      }
      return { success: true };
    }
  }
  throw new Error('Usuario no encontrado.');
}

function deleteUser(token, userId) {
  var sess = requireAdmin(token);
  var ss = getSpreadsheet();
  if (!ss) throw new Error('Sin datos.');
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) throw new Error('Sin hoja de usuarios.');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(userId)) {
      if (String(data[i][1]).toLowerCase() === sess.username.toLowerCase()) {
        throw new Error('No podés eliminar tu propia cuenta.');
      }
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  throw new Error('Usuario no encontrado.');
}
