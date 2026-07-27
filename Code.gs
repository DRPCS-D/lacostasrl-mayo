const SHEET_NAME = 'Pedidos';
const USERS_SHEET_NAME = 'Usuarios';
const CLIENTS_SHEET_NAME = 'Clientes';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o';

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('LA COSTA S.R.L')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

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

// ── User Management (Admin only) ──

function listUsers(token) {
  requireAdminView(token);
  var ss = getSpreadsheet();
  if (!ss) return [];
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  return sheet.getDataRange().getDisplayValues().slice(1).map(function(row) {
    return { id: row[0], username: row[1], rol: row[3], fechaCreacion: row[4], activo: String(row[5]).toLowerCase() };
  });
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
  var id = Utilities.getUuid().substring(0, 8).toUpperCase();
  var fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  sheet.appendRow([id, username, hashPassword(password), rol, fecha, 'true']);
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
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(userId)) {
      var username = (userData.username || '').trim().toLowerCase() || String(data[i][1]);
      var hash = (userData.password && userData.password.length >= 4) ? hashPassword(userData.password) : String(data[i][2]);
      var rol = (userData.rol === 'Admin' || userData.rol === 'AdminL') ? userData.rol : 'User';
      var activo = (userData.activo === false || userData.activo === 'false') ? 'false' : 'true';
      sheet.getRange(i + 1, 2, 1, 5).setValues([[username, hash, rol, String(data[i][4]), activo]]);
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
      return { success: true };
    }
  }
  throw new Error('Cliente no encontrado.');
}

// ── Drive ──

function getDriveFolder() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('DRIVE_FOLDER_ID');
  if (folderId) { try { return DriveApp.getFolderById(folderId); } catch(e) {} }
  var folder = DriveApp.createFolder('Pedidos La Costa');
  props.setProperty('DRIVE_FOLDER_ID', folder.getId());
  return folder;
}

function saveImageToDrive(base64Data, mimeType, meta) {
  var folder = getDriveFolder();
  var ext = mimeType.split('/')[1] || 'jpg';
  var filename = buildImageFilename(meta, ext);
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, filename);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getId();
}

// Construye el nombre del archivo a partir de los datos del pedido:
// N°Orden_CódigoCliente_FechaCarga_Cliente.ext
function buildImageFilename(meta, ext) {
  meta = meta || {};
  // Sanitiza removiendo caracteres no válidos para nombres de archivo
  function clean(s) {
    return String(s || '').replace(/[\\/:*?"<>|\r\n\t]/g, '').replace(/\s+/g, ' ').trim();
  }
  var parts = [
    clean(meta.nroOrden) || 'sinOrden',
    clean(meta.codigoCliente) || 'sinCodigo'
  ];
  var name = parts.join('_');
  if (name.length > 200) name = name.substring(0, 200);
  return name + '.' + ext;
}

function processImage(token, base64Data, mimeType) {
  requireSession(token);
  // No subimos a Drive acá — solo extraemos datos con OpenAI.
  // La subida al Drive ocurre recién en saveOrder (via uploadImageOnly) si la foto no fue subida antes.
  var data = extractFromImage(base64Data, mimeType);
  return { fileId: '', data: data };
}

// Sube la imagen a Drive sin extraer datos — para guardado manual
// meta = { nroOrden, codigoCliente, cliente } se usa para nombrar el archivo
function uploadImageOnly(token, base64Data, mimeType, meta) {
  requireSession(token);
  if (!base64Data || !mimeType) throw new Error('Imagen requerida.');
  return { fileId: saveImageToDrive(base64Data, mimeType, meta) };
}

function extractFromImage(base64Data, mimeType) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '';
  if (!apiKey) throw new Error('API key de OpenAI no configurada en las propiedades del script.');

  var prompt = 'Analiza esta imagen de un formulario de pedido de calzado y extrae los campos del encabezado.\n'
    + 'Devuelve SOLO un objeto JSON válido con exactamente estas claves (sin texto adicional, sin markdown):\n'
    + '{\n'
    + '  "cliente": "",\n'
    + '  "nroPedido": "",\n'
    + '  "entrega": "",\n'
    + '  "direccion": "",\n'
    + '  "formaPago": "",\n'
    + '  "nroOrden": "",\n'
    + '  "marca": "",\n'
    + '  "totalPares": "",\n'
    + '  "totalPrecio": "",\n'
    + '  "obs": ""\n'
    + '}\n\n'
    + 'Reglas:\n'
    + '- "nroOrden": número impreso en grande en el encabezado (ej: "0011504")\n'
    + '- "nroPedido": valor del campo PEDIDO, generalmente una fecha (ej: "19/02/26")\n'
    + '- "totalPares": número de la última fila numérica de la columna CATN/PARES (suma total)\n'
    + '- "totalPrecio": valor monetario total en la esquina inferior derecha (ej: "7.063.000")\n'
    + '- "marca": valor del campo MARCA al pie del formulario\n'
    + '- "obs": texto del campo OBS al pie del formulario (notas manuscritas). Incluí también cualquier anotación adicional escrita en el cuerpo del pedido (ej: "enviado por foto"). Si no hay nada legible, cadena vacía.\n'
    + '- Si un campo no es legible o no existe, usa cadena vacía ""';

  var payload = {
    model: OPENAI_MODEL,
    max_tokens: 2500,
    temperature: 0,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:' + mimeType + ';base64,' + base64Data, detail: 'high' } },
      { type: 'text', text: prompt }
    ]}]
  };

  var response = UrlFetchApp.fetch(OPENAI_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var result = JSON.parse(response.getContentText());
  if (result.error) throw new Error(result.error.message);
  var content = result.choices[0].message.content.trim();
  var jsonStr = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(jsonStr);
}

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
      return { success: true };
    }
  }
  throw new Error('Registro no encontrado: ' + id);
}

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
