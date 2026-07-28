// ── Orders ──

function saveOrder(token, data) {
  var sess = requireSession(token);
  // El cliente debe estar seleccionado del listado y debe existir en la pestaña Clientes
  var codigoCliente = String(data.codigoCliente || '').trim();
  if (!codigoCliente) throw new Error('Debe seleccionar un cliente del listado.');
  var cliRecord = getClientByCodigo(codigoCliente);
  if (!cliRecord) throw new Error('El cliente "' + codigoCliente + '" ya no existe. Refrescá la página.');
  data.codigoCliente = codigoCliente;
  // La foto es obligatoria
  if (!data.imageFileId) throw new Error('La foto del pedido es obligatoria.');

  var sheet = getOrCreateSheet();
  var id = Utilities.getUuid().substring(0, 8).toUpperCase();
  var fechaCarga = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  sheet.appendRow([
    id, fechaCarga,
    data.cliente    || '',
    data.ruc        || '',
    data.nroOrden   || '',
    data.nroPedido  || '',
    data.entrega    || '',
    data.direccion  || '',
    data.ciudad     || '',
    data.formaPago  || '',
    data.tipo       || '',
    data.marca      || '',
    data.totalPares  || '',
    data.totalPrecio || '',
    data.imageFileId || '',
    sess.username,
    data.codigoCliente || '',
    data.obs || '',
    cliRecord.zona || ''
  ]);
  sheet.getRange(sheet.getLastRow(), 1).setValue(id);
  bumpRevision('orders');
  return { success: true, id: id };
}

// Total general de un cliente sumando TODOS los vendedores (sin el filtro por usuario
// que aplica getOrders para el rol User). Se usa en el detalle de Cliente para mostrarle
// al vendedor cuánto le compró el cliente en total, además de lo que él mismo le vendió.
function getClientGlobalTotal(token, codigo, razonSocial) {
  requireSession(token);
  var ss = getSpreadsheet();
  if (!ss) return { total: 0 };
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return { total: 0 };
  var data = sheet.getDataRange().getDisplayValues();
  var headers = data[0];
  var codIdx    = headers.indexOf('Código Cliente');
  var cliIdx    = headers.indexOf('Cliente');
  var precioIdx = headers.indexOf('Total Precio');
  if (precioIdx === -1) return { total: 0 };
  var targetCod = String(codigo || '').trim().toLowerCase();
  var targetRaz = String(razonSocial || '').trim().toLowerCase();
  var total = 0;
  for (var i = 1; i < data.length; i++) {
    var rowCod = codIdx !== -1 ? String(data[i][codIdx] || '').trim().toLowerCase() : '';
    var match = rowCod
      ? (rowCod === targetCod)
      : (cliIdx !== -1 && String(data[i][cliIdx] || '').trim().toLowerCase() === targetRaz);
    if (match) {
      var n = parseFloat(String(data[i][precioIdx] || '').replace(/[^\d-]/g, ''));
      if (isFinite(n)) total += n;
    }
  }
  return { total: total };
}

function getOrders(token) {
  var sess = requireSession(token);
  var ss = getSpreadsheet();
  if (!ss) return [];

  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var sn = sheets[i].getName();
      if (sn !== USERS_SHEET_NAME && sn !== CLIENTS_SHEET_NAME && sheets[i].getLastRow() > 1) {
        sheet = sheets[i];
        break;
      }
    }
  }
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

function updateOrder(token, id, data) {
  requireAdmin(token);
  // El cliente debe estar seleccionado del listado y debe existir en la pestaña Clientes
  var codigoCliente = String(data.codigoCliente || '').trim();
  if (!codigoCliente) throw new Error('Debe seleccionar un cliente del listado.');
  var cliRecord = getClientByCodigo(codigoCliente);
  if (!cliRecord) throw new Error('El cliente "' + codigoCliente + '" ya no existe. Refrescá la página.');
  var sheet = getOrCreateSheet();
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      sheet.getRange(i + 1, 3, 1, 12).setValues([[
        data.cliente     || '',
        data.ruc         || '',
        data.nroOrden    || '',
        data.nroPedido   || '',
        data.entrega     || '',
        data.direccion   || '',
        data.ciudad      || '',
        data.formaPago   || '',
        data.tipo        || '',
        data.marca       || '',
        data.totalPares  || '',
        data.totalPrecio || ''
      ]]);
      // OBS y Código Cliente están fuera del rango contiguo 3-14 → update individual
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var obsIdx = headers.indexOf('OBS');
      if (obsIdx !== -1) {
        sheet.getRange(i + 1, obsIdx + 1).setValue(data.obs || '');
      }
      var codIdx = headers.indexOf('Código Cliente');
      if (codIdx !== -1) {
        sheet.getRange(i + 1, codIdx + 1).setValue(codigoCliente);
      }
      var zonaIdx = headers.indexOf('Zona');
      if (zonaIdx !== -1) {
        sheet.getRange(i + 1, zonaIdx + 1).setValue(cliRecord.zona || '');
      }
      // Si se subió una foto nueva, reemplaza la imagen y manda la vieja a papelera
      var imgIdx = headers.indexOf('Imagen');
      var newImgId = String(data.imageFileId || '').trim();
      if (imgIdx !== -1 && newImgId) {
        var oldImgId = String(values[i][imgIdx] || '').trim();
        if (newImgId !== oldImgId) {
          sheet.getRange(i + 1, imgIdx + 1).setValue(newImgId);
          if (oldImgId) {
            try { DriveApp.getFileById(oldImgId).setTrashed(true); } catch(e) {}
          }
        }
      }
      bumpRevision('orders');
      return { success: true };
    }
  }
  throw new Error('Registro no encontrado: ' + id);
}

function deleteOrder(token, id) {
  requireAdmin(token);
  if (!id) throw new Error('ID requerido.');
  var sheet = getOrCreateSheet();
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var imgIdx = headers.indexOf('Imagen');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      var imageFileId = imgIdx !== -1 ? String(values[i][imgIdx] || '').trim() : '';
      sheet.deleteRow(i + 1);
      if (imageFileId) {
        try { DriveApp.getFileById(imageFileId).setTrashed(true); } catch(e) {}
      }
      bumpRevision('orders');
      return { success: true };
    }
  }
  throw new Error('Registro no encontrado: ' + id);
}
