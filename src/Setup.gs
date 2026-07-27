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
