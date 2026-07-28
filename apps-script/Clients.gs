// ── Clients Management ──

function listClients(token) {
  requireSession(token); // todos los usuarios autenticados pueden leer
  var ss = getSpreadsheet();
  if (!ss) return [];
  var sheet = ss.getSheetByName(CLIENTS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data = sheet.getDataRange().getDisplayValues();
  // Compat: si la pestaña vieja tenía columna ID, saltarla
  var hasOldId = String(data[0][0]).toLowerCase() === 'id';
  var off = hasOldId ? 1 : 0;
  return data.slice(1).map(function(row) {
    return {
      codigo:         row[off]     || '',
      razonSocial:    row[off + 1] || '',
      nombreFantasia: row[off + 2] || '',
      ciudad:         row[off + 3] || '',
      zona:           row[off + 4] || ''
    };
  });
}

function createClient(token, data) {
  requireAdmin(token);
  var codigo = (data.codigo || '').trim();
  var razon  = (data.razonSocial || '').trim();
  var fant   = (data.nombreFantasia || '').trim();
  var ciudad = (data.ciudad || '').trim();
  var zona   = (data.zona || '').trim();
  if (!codigo) throw new Error('El código es requerido.');
  if (razon.length < 2) throw new Error('La razón social debe tener al menos 2 caracteres.');
  var sheet = getOrCreateClientsSheet();
  var existing = sheet.getDataRange().getValues();
  for (var i = 1; i < existing.length; i++) {
    if (String(existing[i][0]).toLowerCase() === codigo.toLowerCase()) {
      throw new Error('El código "' + codigo + '" ya existe.');
    }
  }
  sheet.appendRow([codigo, razon, fant, ciudad, zona]);
  bumpRevision('clients');
  return { success: true };
}

function updateClient(token, originalCodigo, data) {
  requireAdmin(token);
  var sheet = getOrCreateClientsSheet();
  var rows = sheet.getDataRange().getValues();
  var codigo = (data.codigo || '').trim();
  var razon  = (data.razonSocial || '').trim();
  var fant   = (data.nombreFantasia || '').trim();
  var ciudad = (data.ciudad || '').trim();
  var zona   = (data.zona || '').trim();
  if (!codigo) throw new Error('El código es requerido.');
  if (razon.length < 2) throw new Error('La razón social debe tener al menos 2 caracteres.');
  var orig = String(originalCodigo).toLowerCase();
  // Verificar colisión: si cambió el código, que no coincida con otro existente
  for (var i = 1; i < rows.length; i++) {
    var rowCode = String(rows[i][0]).toLowerCase();
    if (rowCode !== orig && rowCode === codigo.toLowerCase()) {
      throw new Error('El código "' + codigo + '" ya pertenece a otro cliente.');
    }
  }
  for (var j = 1; j < rows.length; j++) {
    if (String(rows[j][0]).toLowerCase() === orig) {
      sheet.getRange(j + 1, 1, 1, 5).setValues([[codigo, razon, fant, ciudad, zona]]);
      bumpRevision('clients');
      return { success: true };
    }
  }
  throw new Error('Cliente no encontrado.');
}

function getClientByCodigo(codigo) {
  if (!codigo) return null;
  var ss = getSpreadsheet();
  if (!ss) return null;
  var sheet = ss.getSheetByName(CLIENTS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return null;
  var data = sheet.getDataRange().getDisplayValues();
  var hasOldId = String(data[0][0]).toLowerCase() === 'id';
  var off = hasOldId ? 1 : 0;
  var target = String(codigo).toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][off]).toLowerCase() === target) {
      return {
        codigo:         data[i][off]     || '',
        razonSocial:    data[i][off + 1] || '',
        nombreFantasia: data[i][off + 2] || '',
        ciudad:         data[i][off + 3] || '',
        zona:           data[i][off + 4] || ''
      };
    }
  }
  return null;
}

function deleteClient(token, codigo) {
  requireAdmin(token);
  var ss = getSpreadsheet();
  if (!ss) throw new Error('Sin datos.');
  var sheet = ss.getSheetByName(CLIENTS_SHEET_NAME);
  if (!sheet) throw new Error('Sin hoja de clientes.');
  var rows = sheet.getDataRange().getValues();
  var target = String(codigo).toLowerCase();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === target) {
      sheet.deleteRow(i + 1);
      bumpRevision('clients');
      return { success: true };
    }
  }
  throw new Error('Cliente no encontrado.');
}
