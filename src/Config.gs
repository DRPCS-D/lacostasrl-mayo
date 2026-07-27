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

/**
 * Inserta el contenido de otro archivo HTML del proyecto.
 * Usado por index.html para componer CSS, vistas y scripts.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
