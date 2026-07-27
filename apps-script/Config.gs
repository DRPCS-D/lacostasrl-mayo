const SHEET_NAME = 'Pedidos';
const USERS_SHEET_NAME = 'Usuarios';
const CLIENTS_SHEET_NAME = 'Clientes';
const INFORMES_SHEET_NAME = 'Informes';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o';

/**
 * Este proyecto ya no sirve la interfaz: el frontend vive en GitHub Pages
 * (carpeta web/ del repo) y le habla a este Web App como API JSON vía
 * doPost(). Ver Api.gs.
 */
function doGet() {
  return ContentService.createTextOutput(
    'API de LA COSTA S.R.L.\n' +
    'Este endpoint es el backend (JSON vía POST). El frontend se sirve desde GitHub Pages.'
  ).setMimeType(ContentService.MimeType.TEXT);
}
