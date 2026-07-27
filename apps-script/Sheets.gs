// ── Sheet helpers ──

function getSpreadsheet() {
  var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!ssId) return null;
  try { return SpreadsheetApp.openById(ssId); } catch(e) { return null; }
}

function getOrCreateSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('SPREADSHEET_ID');
  var ss = null;
  if (ssId) { try { ss = SpreadsheetApp.openById(ssId); } catch(e) {} }
  if (!ss) {
    ss = SpreadsheetApp.create('Pedidos La Costa');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  return ss;
}

function getOrCreateSheet() {
  var ss = getOrCreateSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    var headers = [
      'ID', 'Fecha Carga', 'Cliente', 'RUC', 'N° Orden',
      'N° Pedido', 'Entrega', 'Dirección', 'Ciudad',
      'Forma Pago', 'Tipo', 'Marca', 'Total Pares', 'Total Precio', 'Imagen', 'Usuario', 'Código Cliente', 'OBS'
    ];
    sheet.appendRow(headers);
    var hr = sheet.getRange(1, 1, 1, headers.length);
    hr.setFontWeight('bold').setBackground('#8A1B1A').setFontColor('#ffffff').setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 90);
    sheet.setColumnWidth(2, 130);
    sheet.setColumnWidth(3, 160);
    sheet.setColumnWidth(4, 110);
    sheet.setColumnWidth(8, 150);
  }
  ensureImageColumn(sheet);
  ensureUsuarioColumn(sheet);
  ensureCodigoClienteColumn(sheet);
  ensureObsColumn(sheet);
  renameVendedorToTipo(sheet);
  ensureZonaColumn(sheet);
  backfillZonaFromClientes(sheet);
  ensureTextIdColumn(sheet);
  return sheet;
}

function ensureTextIdColumn(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    sheet.getRange(1, 1, sheet.getMaxRows(), 1).setNumberFormat('@');
    return;
  }
  var fmt = sheet.getRange(2, 1).getNumberFormat();
  if (fmt === '@') return;
  sheet.getRange(1, 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  var range = sheet.getRange(2, 1, lastRow - 1, 1);
  var values = range.getValues();
  var updated = false;
  for (var i = 0; i < values.length; i++) {
    if (typeof values[i][0] === 'number') {
      values[i][0] = String(values[i][0]);
      updated = true;
    }
  }
  if (updated) range.setValues(values);
}

// Ejecutar manualmente una vez desde el editor de Apps Script (▶ Ejecutar) para completar
// la Zona de los pedidos ya guardados, sin esperar a que alguien guarde/edite un pedido.
function runZonaBackfillNow() {
  var sheet = getOrCreateSheet();
  Logger.log('Backfill de Zona ejecutado sobre la hoja: ' + sheet.getName());
}

function ensureZonaColumn(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('Zona') === -1) {
    var col = lastCol + 1;
    var cell = sheet.getRange(1, col);
    cell.setValue('Zona');
    cell.setFontWeight('bold').setBackground('#8A1B1A').setFontColor('#ffffff').setHorizontalAlignment('center');
  }
}

// Migración: completa la Zona de pedidos existentes buscando el código de cliente guardado
// en cada fila contra la pestaña Clientes actual. Solo toca filas con Zona vacía.
function backfillZonaFromClientes(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var zonaIdx = headers.indexOf('Zona');
  var codIdx  = headers.indexOf('Código Cliente');
  if (zonaIdx === -1 || codIdx === -1) return;

  var ss = sheet.getParent();
  var clientsSheet = ss.getSheetByName(CLIENTS_SHEET_NAME);
  if (!clientsSheet || clientsSheet.getLastRow() <= 1) return;
  var cdata = clientsSheet.getDataRange().getValues();
  var hasOldId = String(cdata[0][0]).toLowerCase() === 'id';
  var off = hasOldId ? 1 : 0;
  var zonaByCodigo = {};
  for (var i = 1; i < cdata.length; i++) {
    var cod = String(cdata[i][off] || '').trim().toLowerCase();
    if (cod) zonaByCodigo[cod] = cdata[i][off + 4] || '';
  }

  var range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
  var data = range.getValues();
  var anyUpdate = false;
  for (var r = 0; r < data.length; r++) {
    var currentZona = String(data[r][zonaIdx] || '').trim();
    var cod2 = String(data[r][codIdx] || '').trim().toLowerCase();
    if (!currentZona && cod2 && zonaByCodigo[cod2]) {
      data[r][zonaIdx] = zonaByCodigo[cod2];
      anyUpdate = true;
    }
  }
  if (anyUpdate) range.setValues(data);
}

function renameVendedorToTipo(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var vIdx = headers.indexOf('Vendedor');
  if (vIdx !== -1) sheet.getRange(1, vIdx + 1).setValue('Tipo');
}

function getOrCreateClientsSheet() {
  var ss = getOrCreateSpreadsheet();
  var sheet = ss.getSheetByName(CLIENTS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CLIENTS_SHEET_NAME);
    var headers = ['Codigo', 'RazonSocial', 'NombreFantasia', 'Ciudad', 'Zona'];
    sheet.appendRow(headers);
    var hr = sheet.getRange(1, 1, 1, headers.length);
    hr.setFontWeight('bold').setBackground('#8A1B1A').setFontColor('#ffffff').setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(2, 240);
    sheet.setColumnWidth(3, 200);
    sheet.setColumnWidth(4, 140);
    sheet.setColumnWidth(5, 140);
  } else {
    // Migración: si la pestaña ya existía con columna ID, eliminarla
    if (sheet.getLastColumn() >= 1) {
      var firstHeader = sheet.getRange(1, 1).getValue();
      if (String(firstHeader).toLowerCase() === 'id') {
        sheet.deleteColumn(1);
      }
    }
    ensureClientsCiudadZonaColumns(sheet);
  }
  return sheet;
}

function ensureClientsCiudadZonaColumns(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  ['Ciudad', 'Zona'].forEach(function(name) {
    if (headers.indexOf(name) === -1) {
      var col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(name)
        .setFontWeight('bold').setBackground('#8A1B1A').setFontColor('#ffffff').setHorizontalAlignment('center');
      sheet.setColumnWidth(col, 140);
      headers.push(name);
    }
  });
}

function getOrCreateUsersSheet() {
  var ss = getOrCreateSpreadsheet();
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET_NAME);
    var headers = ['ID', 'Username', 'PasswordHash', 'Rol', 'FechaCreacion', 'Activo'];
    sheet.appendRow(headers);
    var hr = sheet.getRange(1, 1, 1, headers.length);
    hr.setFontWeight('bold').setBackground('#8A1B1A').setFontColor('#ffffff').setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(2, 130);
    sheet.setColumnWidth(3, 300);
    sheet.setColumnWidth(4, 80);
    sheet.setColumnWidth(5, 140);
    sheet.setColumnWidth(6, 70);
  }
  ensureTextIdColumn(sheet);
  return sheet;
}

function ensureImageColumn(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('Imagen') === -1) {
    var col = lastCol + 1;
    var cell = sheet.getRange(1, col);
    cell.setValue('Imagen');
    cell.setFontWeight('bold').setBackground('#8A1B1A').setFontColor('#ffffff').setHorizontalAlignment('center');
  }
}

function ensureUsuarioColumn(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('Usuario') === -1) {
    var col = lastCol + 1;
    var cell = sheet.getRange(1, col);
    cell.setValue('Usuario');
    cell.setFontWeight('bold').setBackground('#8A1B1A').setFontColor('#ffffff').setHorizontalAlignment('center');
  }
}

function ensureCodigoClienteColumn(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('Código Cliente') === -1) {
    var col = lastCol + 1;
    var cell = sheet.getRange(1, col);
    cell.setValue('Código Cliente');
    cell.setFontWeight('bold').setBackground('#8A1B1A').setFontColor('#ffffff').setHorizontalAlignment('center');
  }
}

function ensureObsColumn(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('OBS') === -1) {
    var col = lastCol + 1;
    var cell = sheet.getRange(1, col);
    cell.setValue('OBS');
    cell.setFontWeight('bold').setBackground('#8A1B1A').setFontColor('#ffffff').setHorizontalAlignment('center');
  }
}

function linkSpreadsheet(input) {
  var ssId = input.trim();
  var match = ssId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) ssId = match[1];
  try { SpreadsheetApp.openById(ssId); } catch(e) { throw new Error('No se puede acceder a ese Google Sheet. Verificá el ID o la URL.'); }
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ssId);
  return true;
}

function getSpreadsheetUrl() {
  var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!ssId) return '';
  try { return SpreadsheetApp.openById(ssId).getUrl(); } catch(e) { return ''; }
}

function debugSheets() {
  var ss = getSpreadsheet();
  if (!ss) return 'No hay spreadsheet vinculado. SPREADSHEET_ID no configurado.';
  return ss.getSheets().map(function(s) { return s.getName() + ': ' + s.getLastRow() + ' filas'; }).join(' | ');
}
