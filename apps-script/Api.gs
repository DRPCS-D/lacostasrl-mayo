// ────────────────────────────────────────────
// API HTTP para el frontend estático (GitHub Pages)
// ────────────────────────────────────────────
// El frontend ya no corre dentro de Apps Script, así que no tiene acceso al
// google.script.run nativo. En su lugar hace fetch(API_URL) con un body
// { fn, args } y este dispatcher llama a la función real del backend.
// Solo las funciones de esta lista son invocables desde afuera.

var API_WHITELIST = {
  hasUsers: hasUsers,
  login: login,
  logout: logout,
  getSession: getSession,
  createInitialAdmin: createInitialAdmin,
  listUsers: listUsers,
  createUser: createUser,
  updateUser: updateUser,
  deleteUser: deleteUser,
  listClients: listClients,
  createClient: createClient,
  updateClient: updateClient,
  getClientGlobalTotal: getClientGlobalTotal,
  deleteClient: deleteClient,
  processImage: processImage,
  uploadImageOnly: uploadImageOnly,
  saveOrder: saveOrder,
  getOrders: getOrders,
  updateOrder: updateOrder,
  deleteOrder: deleteOrder,
  saveInforme: saveInforme,
  getInformes: getInformes,
  updateInforme: updateInforme,
  deleteInforme: deleteInforme
};

function doPost(e) {
  var result, error;
  try {
    var body = JSON.parse((e.postData && e.postData.contents) || '{}');
    var handler = API_WHITELIST[body.fn];
    if (!handler) throw new Error('Función no permitida: ' + body.fn);
    result = handler.apply(null, body.args || []);
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  return ContentService.createTextOutput(JSON.stringify({ result: result, error: error }))
    .setMimeType(ContentService.MimeType.JSON);
}
