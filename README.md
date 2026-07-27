# Extractor de Pedidos — LA COSTA S.R.L

App para cargar pedidos a partir de una foto o PDF de la orden de compra. La imagen
se procesa con OpenAI Vision, los datos se completan en un formulario y todo se
guarda en Google Sheets. Incluye gestión de clientes, usuarios y un módulo de
reportes con exportación a PDF, CSV y Excel.

**Arquitectura:** el frontend se sirve como página estática desde **GitHub Pages**;
Google Apps Script queda como **API JSON pura** (autenticación, Sheets, Drive,
OpenAI). El frontend le habla a esa API por `fetch`.

## Base de datos

Google Sheets. Un único spreadsheet con tres pestañas, creadas y migradas
automáticamente por el código:

| Pestaña    | Contenido                                    |
|------------|-----------------------------------------------|
| `Pedidos`  | Un pedido por fila                           |
| `Clientes` | Padrón de clientes (código, razón social, …) |
| `Usuarios` | Cuentas y roles (`Admin`, `AdminL`, usuario) |

Las imágenes de las órdenes se guardan en una carpeta de Google Drive.

## Estructura

```
src/                             # Proyecto de Apps Script (clasp rootDir) — solo backend
├── appsscript.json              # Manifiesto
├── Config.gs                    # Constantes y doGet() (texto de estado, ya no HTML)
├── Api.gs                       # doPost(): dispatcher JSON + whitelist de funciones
├── Auth.gs                      # Login, sesiones, hash de contraseñas, permisos
├── Users.gs                     # ABM de usuarios (solo Admin)
├── Clients.gs                   # ABM de clientes
├── Orders.gs                    # ABM de pedidos y totales por cliente
├── Images.gs                    # Drive + extracción OCR con OpenAI Vision
├── Sheets.gs                    # Creación de pestañas, migraciones de columnas
└── Setup.gs                     # Vincular spreadsheet, utilidades de diagnóstico

web/                              # Fuente del frontend (NO se sube a Apps Script)
├── index.html                   # Esqueleto: compone todo con <?!= include('...'); ?>
├── js-api.html                  # google.script.run reimplementado sobre fetch()
├── css-*.html (7 archivos)       # Estilos, uno por área
├── ui-*.html (8 archivos)        # Vistas (pantallas, paneles, modales)
└── js-*.html (16 archivos)       # Lógica de cliente, una por área

scripts/
└── build-pages.js                # Resuelve los include() de web/ y genera docs/index.html

docs/                              # Salida del build — es lo que sirve GitHub Pages
                                    # (generado en CI, no está commiteado)

.github/workflows/deploy-pages.yml # Build + deploy automático a Pages en cada push a main
```

`web/index.html` no contiene lógica: arma la página con `<?!= include('...') ?>`,
igual que un template de Apps Script. Todos los `js-*.html` se inyectan dentro de un
único bloque `<script>`, así que comparten el mismo scope global y el hoisting
funciona igual que en un archivo único. `scripts/build-pages.js` resuelve esos
mismos `include()` en tiempo de build (no hace falta el runtime de Apps Script para
eso) y escribe el resultado ya aplanado en `docs/index.html`.

## Cómo se conectan Pages y Apps Script

`web/js-api.html` reemplaza `google.script.run` por un objeto con la misma forma
(`.withSuccessHandler(...).withFailureHandler(...).nombreDeFuncion(args)`), pero
implementado con `fetch()` contra la URL de implementación del Web App. Por eso
ninguno de los ~25 call sites del resto del frontend tuvo que cambiar.

En el backend, `Api.gs` expone un único `doPost(e)` que recibe `{ fn, args }` y
llama a la función correspondiente de una whitelist explícita — no ejecuta nombres
arbitrarios.

**CORS:** Apps Script no implementa `doOptions`, así que el fetch tiene que viajar
como *simple request* para no disparar un preflight OPTIONS (que fallaría). Por eso
`js-api.html` no fija `Content-Type` — al mandar un string como body, el navegador
lo manda como `text/plain`, que está en la lista segura de CORS. Si en algún momento
alguien agrega headers custom al fetch, esto se rompe.

## Puesta en marcha

### 1. Backend (Apps Script)

Requiere [clasp](https://github.com/google/clasp).

```bash
npm install -g @google/clasp
clasp login
```

Copiá `.clasp.json.example` a `.clasp.json` y poné el `scriptId` del proyecto (está
en el editor de Apps Script, en *Configuración del proyecto*). `.clasp.json` está en
`.gitignore` porque es específico de cada instalación.

Antes del primer push conviene traer el manifiesto real del proyecto, para no pisar
la configuración de despliegue que ya tenga:

```bash
clasp pull
clasp push
```

En *Configuración del proyecto → Propiedades del script*, cargar:

| Propiedad         | Descripción                                                   |
|-------------------|----------------------------------------------------------------|
| `SPREADSHEET_ID`  | ID del Google Sheet. Se puede setear con `linkSpreadsheet()`  |
| `DRIVE_FOLDER_ID` | Carpeta de Drive donde se guardan las fotos                   |
| `OPENAI_API_KEY`  | API key de OpenAI para la extracción de datos                 |

Publicá la Web App: *Implementar → Nueva implementación → Aplicación web*, acceso
"Cualquier usuario". Copiá la URL que termina en `/exec` — es la que va en el
siguiente paso.

### 2. Frontend (GitHub Pages)

1. Pegá la URL `/exec` del paso anterior en `web/js-api.html`, reemplazando
   `PEGAR_AQUI_LA_URL_DE_IMPLEMENTACION/exec`.
2. Commiteá y pusheá a `main`.
3. En el repo de GitHub: *Settings → Pages → Build and deployment → Source:
   **GitHub Actions*** (paso único, manual — no se puede hacer por git push).
4. El workflow `.github/workflows/deploy-pages.yml` corre en cada push a `main`
   que toque `web/` o el script de build: genera `docs/index.html` y lo despliega.
   La URL de Pages queda visible en la pestaña *Actions* del run, o en *Settings →
   Pages*.

Para probar localmente antes de pushear:

```bash
node scripts/build-pages.js
```

Esto genera `docs/index.html` (ignorado por git); abrilo directo en el navegador o
serví la carpeta con cualquier servidor estático.

**Importante:** cada vez que Apps Script genera una implementación *nueva* (no una
versión de una implementación existente), la URL `/exec` cambia. Si eso pasa, hay
que actualizar `web/js-api.html` y volver a pushear.

### Primer uso

Al abrir la página por primera vez, si no hay usuarios cargados en la pestaña
`Usuarios` aparece la pantalla de setup para crear el administrador inicial.

## Notas

- El código del cliente es ES5 (`var`, sin módulos) porque no hay build step de JS
  (el único build es el aplanado de `web/` → `docs/`, que es texto plano).
- Los IDs de registro son hex de 8 caracteres. La columna A de cada pestaña se
  formatea como texto (`@`) para que Sheets no los convierta a número o a notación
  científica.
- `debugSheets()` devuelve un resumen de las pestañas y su cantidad de filas
  (correrlo desde el editor de Apps Script, no es parte de la API pública).
