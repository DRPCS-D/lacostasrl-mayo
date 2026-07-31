// ── Clients Management ──

function listClients(token) {
  requireSession(token); // todos los usuarios autenticados pueden leer
  var ss = getSpreadsheet();
  if (!ss) return [];
  var sheet = ss.getSheetByName(CLIENTS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  ensureClientsCiudadZonaColumns(sheet);
  var display = sheet.getDataRange().getDisplayValues();
  var raw = sheet.getDataRange().getValues();
  // Compat: si la pestaña vieja tenía columna ID, saltarla
  var hasOldId = String(display[0][0]).toLowerCase() === 'id';
  var off = hasOldId ? 1 : 0;
  var headers = display[0];
  var latIdx = headers.indexOf('Lat');
  var lngIdx = headers.indexOf('Lng');
  return display.slice(1).map(function(row, i) {
    return {
      codigo:         row[off]     || '',
      razonSocial:    row[off + 1] || '',
      nombreFantasia: row[off + 2] || '',
      ciudad:         row[off + 3] || '',
      zona:           row[off + 4] || '',
      // Lat/Lng van como número crudo (no getDisplayValues) porque el
      // locale del Sheet (coma decimal) rompe el parseFloat del frontend.
      lat: latIdx !== -1 ? raw[i + 1][latIdx] : '',
      lng: lngIdx !== -1 ? raw[i + 1][lngIdx] : ''
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
  ensureClientsCiudadZonaColumns(sheet);
  var display = sheet.getDataRange().getDisplayValues();
  var raw = sheet.getDataRange().getValues();
  var hasOldId = String(display[0][0]).toLowerCase() === 'id';
  var off = hasOldId ? 1 : 0;
  var headers = display[0];
  var latIdx = headers.indexOf('Lat');
  var lngIdx = headers.indexOf('Lng');
  var target = String(codigo).toLowerCase();
  for (var i = 1; i < display.length; i++) {
    if (String(display[i][off]).toLowerCase() === target) {
      return {
        codigo:         display[i][off]     || '',
        razonSocial:    display[i][off + 1] || '',
        nombreFantasia: display[i][off + 2] || '',
        ciudad:         display[i][off + 3] || '',
        zona:           display[i][off + 4] || '',
        lat: latIdx !== -1 ? raw[i][latIdx] : '',
        lng: lngIdx !== -1 ? raw[i][lngIdx] : ''
      };
    }
  }
  return null;
}

// Se llama al guardar un informe de visita (ver saveInforme en Informes.gs):
// deja la ubicación del cliente en la de la visita más reciente. No es
// destructivo para el resto de los datos del cliente (Razón Social, etc.),
// solo pisa Lat/Lng. Si el cliente no existe más, no hace nada (no debería
// pasar — saveInforme ya validó que existe antes de llamar acá).
function updateClientLocation(codigo, lat, lng) {
  var ss = getSpreadsheet();
  if (!ss) return;
  var sheet = ss.getSheetByName(CLIENTS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return;
  ensureClientsCiudadZonaColumns(sheet);
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var latIdx = headers.indexOf('Lat');
  var lngIdx = headers.indexOf('Lng');
  if (latIdx === -1 || lngIdx === -1) return;
  var codes = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  var target = String(codigo).toLowerCase();
  for (var i = 0; i < codes.length; i++) {
    if (String(codes[i][0]).toLowerCase() === target) {
      var row = i + 2;
      sheet.getRange(row, latIdx + 1, 1, 2).setValues([[lat, lng]]);
      bumpRevision('clients');
      return;
    }
  }
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
