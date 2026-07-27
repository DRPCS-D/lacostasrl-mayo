# Extractor de Pedidos — LA COSTA S.R.L

Web App de Google Apps Script para cargar pedidos a partir de una foto o PDF de la
orden de compra. La imagen se procesa con OpenAI Vision, los datos se completan en un
formulario y todo se guarda en Google Sheets. Incluye gestión de clientes, usuarios y
un módulo de reportes con exportación a PDF, CSV y Excel.

## Base de datos

Google Sheets. Un único spreadsheet con tres pestañas, creadas y migradas
automáticamente por el código:

| Pestaña    | Contenido                                    |
|------------|----------------------------------------------|
| `Pedidos`  | Un pedido por fila                           |
| `Clientes` | Padrón de clientes (código, razón social, …) |
| `Usuarios` | Cuentas y roles (`Admin`, `AdminL`, usuario) |

Las imágenes de las órdenes se guardan en una carpeta de Google Drive.

## Estructura

```
src/
├── appsscript.json               # Manifiesto del proyecto GAS
│
├── Config.gs                     # Constantes, doGet() e include()
├── Auth.gs                       # Login, sesiones, hash de contraseñas, permisos
├── Users.gs                      # ABM de usuarios (solo Admin)
├── Clients.gs                    # ABM de clientes
├── Orders.gs                     # ABM de pedidos y totales por cliente
├── Images.gs                     # Drive + extracción OCR con OpenAI Vision
├── Sheets.gs                     # Creación de pestañas, migraciones de columnas
├── Setup.gs                      # Vincular spreadsheet, utilidades de diagnóstico
│
├── index.html                    # Esqueleto: compone todo con include()
│
├── css-base.html                 # Reset, variables de color, loading
├── css-auth.html                 # Pantallas de login y setup inicial
├── css-layout.html               # Wrapper, drawer, header, tabs, main
├── css-pedido.html               # Grid de Nuevo Pedido, dropzone, visor de foto
├── css-tabla.html                # Tabla, búsqueda, filtros, KPIs, paginación, toast
├── css-modales.html              # Modales, confirm, campos de solo lectura
├── css-reportes.html             # Reportes y área de impresión
│
├── ui-auth.html                  # Loading + pantallas de autenticación
├── ui-shell.html                 # Header, drawer lateral y barra de tabs
├── ui-panel-nuevo.html           # Panel: Nuevo Pedido
├── ui-panel-pedidos.html         # Panel: listado de pedidos
├── ui-panel-usuarios.html        # Panel: usuarios
├── ui-panel-clientes.html        # Panel: clientes
├── ui-panel-reportes.html        # Panel: reportes
├── ui-modales.html               # Toast, confirm, visor de fotos y modales
│
├── js-state.html                 # Estado global del cliente
├── js-app.html                   # Arranque, pantallas, drawer, secciones, tabs
├── js-auth.html                  # Login, setup, logout
├── js-imagen.html                # Drag & drop, compresión, rotación, PDF, visor
├── js-pedido-form.html           # Extracción OCR y guardado del pedido
├── js-pedidos-tabla.html         # Tabla, filtros, orden, KPIs, export a Excel
├── js-pedido-ver.html            # Modal Ver Pedido
├── js-pedido-editar.html         # Modal Editar Pedido
├── js-reportes.html              # Gráficos y agregaciones
├── js-reportes-export.html       # Exportación a PDF y CSV
├── js-usuarios.html              # Gestión de usuarios
├── js-clientes-autocomplete.html # Autocomplete de cliente
├── js-clientes.html              # Gestión de clientes
├── js-cliente-ver.html           # Modal Ver Cliente
├── js-confirm.html               # Modal de confirmación
└── js-feedback.html              # Animación de error en campos + toast
```

`index.html` no contiene lógica: arma la página con `<?!= include('...') ?>`.
Todos los `js-*.html` se inyectan dentro de un único bloque `<script>`, así que
comparten el mismo scope global y el hoisting funciona igual que en un archivo único.

## Puesta en marcha

Requiere [clasp](https://github.com/google/clasp).

```bash
npm install -g @google/clasp
```

```bash
clasp login
```

Copiá `.clasp.json.example` a `.clasp.json` y poné el `scriptId` del proyecto
(está en el editor de Apps Script, en *Configuración del proyecto*). `.clasp.json`
está en `.gitignore` porque es específico de cada instalación.

Antes del primer push conviene traer el manifiesto real del proyecto, para no pisar
la configuración de despliegue que ya tenga:

```bash
clasp pull
```

Después, para subir cambios:

```bash
clasp push
```

### Propiedades del script

En *Configuración del proyecto → Propiedades del script*:

| Propiedad         | Descripción                                            |
|-------------------|--------------------------------------------------------|
| `SPREADSHEET_ID`  | ID del Google Sheet. Se puede setear con `linkSpreadsheet()` |
| `DRIVE_FOLDER_ID` | Carpeta de Drive donde se guardan las fotos            |
| `OPENAI_API_KEY`  | API key de OpenAI para la extracción de datos          |

### Primer uso

Publicá la Web App (*Implementar → Nueva implementación → Aplicación web*). Al
abrirla por primera vez, si no hay usuarios cargados aparece la pantalla de setup
para crear el administrador inicial.

## Notas

- El código del cliente es ES5 (`var`, sin módulos) porque corre sin build step.
- Los IDs de registro son hex de 8 caracteres. La columna A de cada pestaña se
  formatea como texto (`@`) para que Sheets no los convierta a número o a notación
  científica.
- `debugSheets()` devuelve un resumen de las pestañas y su cantidad de filas.
