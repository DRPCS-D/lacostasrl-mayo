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
apps-script/                     # Proyecto de Apps Script (clasp rootDir) — solo backend
├── appsscript.json              # Manifiesto
├── Config.gs                    # Constantes y doGet() (texto de estado, ya no HTML)
├── Api.gs                       # doPost(): dispatcher JSON + whitelist de funciones
├── Auth.gs                      # Login, sesiones, hash de contraseñas, permisos
├── Users.gs                     # ABM de usuarios (solo Admin)
├── Clients.gs                   # ABM de clientes
├── Orders.gs                    # ABM de pedidos y totales por cliente
├── Images.gs                    # Drive + extracción OCR con OpenAI Vision
└── Sheets.gs                    # Creación de pestañas, migraciones de columnas, link del spreadsheet

web/                              # Frontend estático — esto es lo que sirve GitHub Pages
├── index.html                   # Markup de la app
├── manifest.json                # Manifest PWA (nombre, íconos, modo standalone)
├── sw.js                        # Service worker: cachea el app shell, no toca API ni CDN
├── icons/                       # Íconos PWA (192/512, maskable, apple-touch-icon)
├── css/styles.css               # Estilos
└── js/
    ├── api.js                   # google.script.run reimplementado sobre fetch()
    └── app.js                   # Lógica de cliente (auth, pedidos, clientes, usuarios, reportes)

scripts/gen-icons.js              # Genera web/icons/*.png (sin dependencias externas)

.github/workflows/deploy-pages.yml # Publica web/ a GitHub Pages en cada push a main
```

`web/js/api.js` reemplaza `google.script.run` por un objeto con la misma forma
(`.withSuccessHandler(...).withFailureHandler(...).nombreDeFuncion(args)`), pero
implementado con `fetch()` contra la URL de implementación del Web App. Por eso
ninguno de los ~25 call sites de `app.js` tuvo que cambiar.

En el backend, `Api.gs` expone un único `doPost(e)` que recibe `{ fn, args }` y
llama a la función correspondiente de una whitelist explícita — no ejecuta nombres
arbitrarios.

**CORS:** Apps Script no implementa `doOptions`, así que el fetch tiene que viajar
como *simple request* para no disparar un preflight OPTIONS (que fallaría). Por eso
`api.js` no fija `Content-Type` — al mandar un string como body, el navegador lo
manda como `text/plain`, que está en la lista segura de CORS. Si en algún momento
alguien agrega headers custom al fetch, esto se rompe.

## Puesta en marcha

### 1. Backend (Apps Script)

Requiere [clasp](https://github.com/google/clasp).

```bash
npm install -g @google/clasp
clasp login
```

Creá un proyecto de Apps Script nuevo (o reutilizá uno existente), copiá
`apps-script/.clasp.json.example` a `apps-script/.clasp.json` y poné el `scriptId`
(está en el editor de Apps Script, en *Configuración del proyecto*).
`apps-script/.clasp.json` está en `.gitignore` porque es específico de cada
instalación.

```bash
cd apps-script
clasp push
```

En *Configuración del proyecto → Propiedades del script*, cargar:

| Propiedad         | Descripción                                                   |
|-------------------|----------------------------------------------------------------|
| `SPREADSHEET_ID`  | ID del Google Sheet. Se puede setear con `linkSpreadsheet()`  |
| `DRIVE_FOLDER_ID` | Carpeta de Drive donde se guardan las fotos (se crea sola si falta) |
| `OPENAI_API_KEY`  | API key de OpenAI para la extracción de datos                 |

Publicá la Web App: *Implementar → Nueva implementación → Aplicación web*, acceso
"Cualquier usuario". Copiá la URL que termina en `/exec` — es la que va en el
siguiente paso.

### 2. Frontend (GitHub Pages)

1. Pegá la URL `/exec` del paso anterior en `web/js/api.js`, reemplazando
   `PEGAR_AQUI_LA_URL_DE_IMPLEMENTACION/exec`.
2. Commiteá y pusheá a `main`.
3. En el repo de GitHub: *Settings → Pages → Build and deployment → Source:
   **GitHub Actions*** (paso único, manual — no se puede hacer por git push).
4. El workflow `.github/workflows/deploy-pages.yml` corre en cada push a `main`
   que toque `web/` y publica esa carpeta tal cual. La URL de Pages queda visible
   en la pestaña *Actions* del run, o en *Settings → Pages*.

**Importante:** cada vez que Apps Script genera una implementación *nueva* (no una
versión de una implementación existente), la URL `/exec` cambia. Si eso pasa, hay
que actualizar `web/js/api.js` y volver a pushear.

### Primer uso

Al abrir la página por primera vez, si no hay usuarios cargados en la pestaña
`Usuarios` aparece la pantalla de setup para crear el administrador inicial.

## PWA (instalar como app)

`web/manifest.json` + `web/sw.js` hacen que el navegador ofrezca "Instalar app" /
"Agregar a pantalla de inicio":

- **Android/Chrome/Edge:** aparece el banner de instalación automáticamente (o
  desde el menú ⋮ → "Instalar app"). Requiere HTTPS, que GitHub Pages ya da.
- **iPhone/Safari:** no hay banner automático — hay que abrir el sitio, tocar
  Compartir → "Agregar a inicio". Las meta tags `apple-mobile-web-app-*` en
  `index.html` hacen que se vea sin la barra de Safari.
- El service worker (`sw.js`) solo cachea el *app shell* (HTML/CSS/JS/íconos,
  mismo origen). Nunca cachea las llamadas a la API (`POST` a Apps Script) ni
  los scripts de CDN (pdf.js, heic2any) — esos siempre van a la red. Esto
  permite que la app abra rápido y offline muestre al menos la interfaz, pero
  igual necesita conexión para cargar/guardar pedidos reales.
- Los íconos (`web/icons/*.png`) se generan con `node scripts/gen-icons.js`
  (no depende de ImageMagick/sharp, dibuja el PNG a mano). Para cambiar el
  diseño del ícono, editá ese script y volvé a correrlo.

### Versionado y actualización forzada

`web/js/version.js` define `APP_VERSION`, la única fuente de verdad que usan:

- `sw.js` (vía `importScripts`) para nombrar el caché (`pedidos-lacosta-vX`) —
  subir `APP_VERSION` invalida el caché viejo en el próximo `activate`.
- El drawer, que muestra `vX` al pie del menú lateral.

**Cada vez que cambie algo en `web/`, subí el número en `web/js/version.js`**
antes de pushear. Eso solo no alcanza para que una pestaña ya abierta (o la
PWA ya instalada) baje los archivos nuevos de inmediato — el navegador recién
revisa si hay un service worker distinto en su próxima visita o `update()`
periódico. Por eso el drawer tiene un botón **"Actualizar app"**: desregistra
el service worker, borra todos los cachés y recarga con cache-busting, así el
usuario nunca queda pegado con una versión vieja aunque no vuelva a cerrar la
app. Además, si el navegador ya bajó el service worker nuevo en segundo plano
(pero la pestaña abierta sigue con el viejo), el drawer muestra automáticamente
un badge "Nueva versión" sobre ese botón.

**Chequeo obligatorio al abrir la app:** antes de arrancar (`window.onload`),
`checkForNewVersion()` en `app.js` pide `js/version.js` con `cache: 'no-store'`
(esquivando el caché HTTP y el del service worker) y compara el `APP_VERSION`
recién bajado contra el que ya está cargado en esta pestaña. Si difieren, la
app no llega a mostrar login ni datos: tapa todo con un modal ("Hay una
versión nueva") con un único botón "Actualizar ahora", que dispara el mismo
`forceUpdateApp()` del drawer. Si no hay red, el chequeo falla en silencio y
la app sigue con lo que ya tiene cargado (no bloquea por un error de conexión).

## Escalar

- **Más de una instalación / cliente:** cada una es un Apps Script propio (con su
  `SPREADSHEET_ID`, `DRIVE_FOLDER_ID` y `OPENAI_API_KEY`) más su propia
  implementación Web App. El mismo `web/` sirve para todas — solo cambia la
  `API_URL` en `api.js`, así que conviene mantener un `api.js` por
  despliegue de Pages si se necesita separar entornos (prod/staging).
- **Límites de Apps Script:** cuotas diarias de `UrlFetchApp` (llamadas a OpenAI) y
  tiempo de ejecución por request (6 min) son las restricciones típicas a vigilar
  a medida que crece el volumen de pedidos.
- **Sheets como base de datos:** cómodo y sin costo hasta unos pocos miles de filas
  activas; por encima de eso, las lecturas completas de `getDataRange()` en
  `getOrders`/`listClients` empiezan a pesar. Si se vuelve un cuello de botella, el
  siguiente paso natural es migrar esas hojas a una base real (p. ej. Postgres)
  detrás del mismo `doPost` whitelist, sin tocar el frontend.

## Notas

- El código del cliente es ES5 (`var`, sin módulos) porque no hay build step de JS.
- Los IDs de registro son hex de 8 caracteres. La columna A de cada pestaña se
  formatea como texto (`@`) para que Sheets no los convierta a número o a notación
  científica.
- `debugSheets()` devuelve un resumen de las pestañas y su cantidad de filas
  (correrlo desde el editor de Apps Script, no es parte de la API pública).
