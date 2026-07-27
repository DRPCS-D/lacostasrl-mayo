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
