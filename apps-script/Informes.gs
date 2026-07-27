// ── Informes de visitas ──
// Registro de visitas de vendedores a clientes: cliente (del padrón), comentario,
// ubicación GPS (obligatoria) y fecha/vendedor sellados por el backend. Mismo
// patrón de permisos que Pedidos: Admin edita/borra cualquiera, AdminL ve todo
// en solo lectura, User ve y carga solo los propios.

function saveInforme(token, data) {
  var sess = requireSession(token);
  var codigoCliente = String((data && data.codigoCliente) || '').trim();
  if (!codigoCliente) throw new Error('Debe seleccionar un cliente del listado.');
  var cli = getClientByCodigo(codigoCliente);
  if (!cli) throw new Error('El cliente "' + codigoCliente + '" ya no existe. Refrescá la página.');

  var lat = parseFloat(data && data.lat);
  var lng = parseFloat(data && data.lng);
  if (!isFinite(lat) || !isFinite(lng)) throw new Error('La ubicación es obligatoria para guardar el informe.');

  var sheet = getOrCreateInformesSheet();
  var id = Utilities.getUuid().substring(0, 8).toUpperCase();
  var fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  sheet.appendRow([
    id, fecha,
    cli.razonSocial || '',
    codigoCliente,
    cli.ciudad || '',
    cli.zona   || '',
    (data && data.comentario) || '',
    lat, lng,
    sess.username
  ]);
  sheet.getRange(sheet.getLastRow(), 1).setValue(id);
  return { success: true, id: id };
}

function getInformes(token) {
  var sess = requireSession(token);
  var ss = getSpreadsheet();
  if (!ss) return [];
  var sheet = ss.getSheetByName(INFORMES_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getDataRange().getDisplayValues();
  var headers = data[0];
  var rows = data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[String(h)] = row[i]; });
    return obj;
  }).reverse();

  if (sess.rol !== 'Admin' && sess.rol !== 'AdminL') {
    rows = rows.filter(function(r) { return r['Usuario'] === sess.username; });
  }
  return rows;
}

function updateInforme(token, id, data) {
  requireAdmin(token);
  if (!id) throw new Error('ID requerido.');
  var codigoCliente = String((data && data.codigoCliente) || '').trim();
  if (!codigoCliente) throw new Error('Debe seleccionar un cliente del listado.');
  var cli = getClientByCodigo(codigoCliente);
  if (!cli) throw new Error('El cliente "' + codigoCliente + '" ya no existe. Refrescá la página.');

  var sheet = getOrCreateInformesSheet();
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var codIdx = headers.indexOf('Código Cliente');
  var cliIdx = headers.indexOf('Cliente');
  var ciuIdx = headers.indexOf('Ciudad');
  var zonIdx = headers.indexOf('Zona');
  var comIdx = headers.indexOf('Comentario');

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      var row = i + 1;
      if (cliIdx !== -1) sheet.getRange(row, cliIdx + 1).setValue(cli.razonSocial || '');
      if (codIdx !== -1) sheet.getRange(row, codIdx + 1).setValue(codigoCliente);
      if (ciuIdx !== -1) sheet.getRange(row, ciuIdx + 1).setValue(cli.ciudad || '');
      if (zonIdx !== -1) sheet.getRange(row, zonIdx + 1).setValue(cli.zona || '');
      if (comIdx !== -1) sheet.getRange(row, comIdx + 1).setValue((data && data.comentario) || '');
      // La ubicación capturada no se edita: es el punto real donde ocurrió la visita.
      return { success: true };
    }
  }
  throw new Error('Registro no encontrado: ' + id);
}

function deleteInforme(token, id) {
  requireAdmin(token);
  if (!id) throw new Error('ID requerido.');
  var sheet = getOrCreateInformesSheet();
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  throw new Error('Registro no encontrado: ' + id);
}
