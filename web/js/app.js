  // ── Auth state ──
  var authToken    = null;
  var authUsername = null;
  var authRol      = null;
  var authFotoUrl  = null;

  // ── Order state ──
  var currentBase64 = null;
  var currentMime   = null;
  var currentFileId = null;
  // Cola de páginas cuando se sube un PDF multipágina
  // Cada item: { dataUrl: 'data:image/png;base64,...', mime: 'image/png' }
  var pdfQueue = [];
  var pdfIndex = 0;
  var recordsCache  = {};
  var allRecords    = [];
  var selectedRowId = null;

  // ── Users state ──
  var usersCache   = {};
  var editingUserId = null;
  var viewingUserId = null;
  var pendingUserFoto = null; // { dataUrl, mime } tras elegir/comprimir una foto nueva
  var removeUserFotoFlag = false; // true = el usuario tocó "Quitar foto" al editar

  // ── Clientes state ──
  var allClients = [];                  // [{codigo, razonSocial, nombreFantasia}]
  var clientesCache = {};               // por código (lowercase), para edición
  var editingClienteCodigo = null;      // código original del cliente en edición
  var selectedClienteCodigo = '';       // código del cliente seleccionado en Nuevo Pedido
  var selectedEditClienteCodigo = '';   // código del cliente seleccionado en Editar Pedido
  var acActiveIdx = -1;                 // índice del item activo en el autocomplete (teclado)
  var acFiltered = [];                  // resultados actuales del autocomplete

  // ── Order edit state ──
  var editingId = null;
  // Cambio de foto en el modal de edición:
  // null = mantener la foto actual, string = base64 de la nueva foto pendiente de subir
  var editingNewImageBase64 = null;
  var editingNewImageMime   = null;
  var editingCurrentImgId   = null;

  // ── Informes state (visitas de vendedores) ──
  var allInformes = [];
  var informesCache = {};
  var viewingInformeId = null;
  var editingInformeId = null;
  var selectedInformeClienteCodigo = '';     // cliente elegido en Nuevo informe
  var selectedEditInformeClienteCodigo = ''; // cliente elegido al editar un informe
  var currentInformeLat = null;
  var currentInformeLng = null;
  var informesMap = null;       // instancia Leaflet, se crea una sola vez
  var informesClusterGroup = null; // agrupa markers cercanos según el zoom, para rendir bien con muchos puntos
  var pendingInformeMapFocusId = null; // "Ver en mapa": ID a enfocar en el próximo render del mapa
  var informesMarkers = [];     // markers actuales del mapa
  var informesCurrentTab = 'nuevo-informe';
  var informesCurrentPage = 1;
  var INFORMES_PAGE_SIZE = 10;
  var informeSortState = { column: null, direction: 'asc' };
  var INFORME_DATE_COLS = ['Fecha'];

  // ────────────────────────────────────────────
  // INIT
  // ────────────────────────────────────────────
  window.onload = function() {
    checkForNewVersion(function(isOutdated) {
      if (isOutdated) {
        showUpdateRequiredModal();
        return; // no arranca la app hasta que actualice
      }
      initApp();
    });
  };

  // Compara el APP_VERSION con el que ya está en memoria (embebido en esta
  // misma carga de página) contra el que está publicado ahora mismo en
  // js/version.js, pidiéndolo con cache: 'no-store' para saltarse tanto el
  // caché HTTP del navegador como el del service worker. Si difieren, esta
  // pestaña (o la PWA instalada) está corriendo código viejo.
  function checkForNewVersion(callback) {
    fetch('js/version.js?_=' + Date.now(), { cache: 'no-store' })
      .then(function(res) { return res.text(); })
      .then(function(text) {
        var m = text.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
        var remoteVersion = m ? m[1] : null;
        callback(!!remoteVersion && remoteVersion !== APP_VERSION);
      })
      .catch(function() { callback(false); }); // sin red/offline → seguir con lo que ya está cargado
  }

  function showUpdateRequiredModal() {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('update-required-overlay').style.display = 'flex';
  }

  function initApp() {
    authToken    = localStorage.getItem('authToken');
    authUsername = localStorage.getItem('authUsername');
    authRol      = localStorage.getItem('authRol');
    authFotoUrl  = localStorage.getItem('authFotoUrl');

    google.script.run
      .withSuccessHandler(function(usersExist) {
        if (!usersExist) {
          showScreen('setup');
        } else if (!authToken) {
          showScreen('login');
        } else {
          google.script.run
            .withSuccessHandler(function(sess) {
              if (sess) {
                authUsername = sess.username;
                authRol      = sess.rol;
                authFotoUrl  = sess.fotoUrl || '';
                localStorage.setItem('authUsername', authUsername);
                localStorage.setItem('authRol', authRol);
                localStorage.setItem('authFotoUrl', authFotoUrl);
                launchApp();
              } else {
                clearAuth();
                showScreen('login');
              }
            })
            .withFailureHandler(function() { clearAuth(); showScreen('login'); })
            .getSession(authToken);
        }
      })
      .withFailureHandler(function() { showScreen('login'); })
      .hasUsers();
  }

  // ────────────────────────────────────────────
  // SCREEN MANAGEMENT
  // ────────────────────────────────────────────
  function showScreen(name) {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display   = 'none';
    document.getElementById('app-wrapper').style.display   = 'none';

    if (name === 'login' || name === 'setup') {
      document.getElementById('auth-screen').style.display  = 'flex';
      document.getElementById('screen-login').style.display = name === 'login' ? 'block' : 'none';
      document.getElementById('screen-setup').style.display = name === 'setup' ? 'block' : 'none';
    } else if (name === 'app') {
      document.getElementById('app-wrapper').style.display = 'block';
    }
  }

  // Muestra la foto de perfil del vendedor en el avatar del drawer si tiene
  // una cargada (ver Usuarios); si no, o si la imagen falla, cae a la inicial.
  function renderDrawerAvatar() {
    var el = document.getElementById('drawer-avatar');
    var initial = (authUsername || '?').charAt(0).toUpperCase();
    if (authFotoUrl) {
      el.innerHTML = '<img src="' + esc(authFotoUrl) + '" alt="" onerror="this.parentNode.textContent=\'' + esc(initial) + '\'">';
    } else {
      el.textContent = initial;
    }
  }

  function launchApp() {
    // Drawer user info
    document.getElementById('drawer-username').textContent = authUsername;
    document.getElementById('drawer-role').textContent = (authRol || '').toUpperCase();
    renderDrawerAvatar();
    document.getElementById('home-username').textContent = (authUsername || '').toUpperCase();
    // Admin items
    var isAdmin   = authRol === 'Admin';
    var isAdminL  = authRol === 'AdminL';
    var canSeeAll = isAdmin || isAdminL;
    // Pestañas admin: visibles para Admin y AdminL (AdminL en modo lectura)
    document.getElementById('drawer-usuarios').style.display = canSeeAll ? '' : 'none';
    document.getElementById('drawer-clientes').style.display = '';
    document.getElementById('drawer-reportes').style.display = canSeeAll ? '' : 'none';
    document.getElementById('drawer-informes').style.display = '';
    document.getElementById('home-card-usuarios').style.display = canSeeAll ? '' : 'none';
    document.getElementById('home-card-reportes').style.display = canSeeAll ? '' : 'none';
    // Botones de creación: solo Admin
    var btnNewUser = document.getElementById('btn-new-user');
    if (btnNewUser) btnNewUser.style.display = isAdmin ? '' : 'none';
    var btnNewCli  = document.getElementById('btn-new-cliente');
    if (btnNewCli)  btnNewCli.style.display  = isAdmin ? '' : 'none';
    showScreen('app');
    // Cargar clientes en cache (necesario para autocomplete — todos los usuarios)
    refreshClientsCache();
    // Precargar pedidos en cache (necesario para el chequeo de N° Orden duplicado
    // antes de que el usuario entre a la pestaña Pedidos)
    preloadRecordsCache();
    // Entrar a la pantalla de Inicio por defecto
    switchSection('inicio', { skipClose: true });
  }

  function refreshClientsCache() {
    google.script.run
      .withSuccessHandler(function(rows) { allClients = rows || []; })
      .withFailureHandler(function() { allClients = []; })
      .listClients(authToken);
  }

  // Carga silenciosa de pedidos al iniciar la app (no toca la UI de la tabla).
  // Solo llena allRecords + recordsCache para que el chequeo de duplicados funcione
  // aunque el usuario nunca haya visitado la pestaña Pedidos en esta sesión.
  function preloadRecordsCache() {
    google.script.run
      .withSuccessHandler(function(rows) {
        // Si el usuario ya entró a Pedidos y disparó loadRecords antes que esto vuelva,
        // no pisamos lo recién cargado.
        if (allRecords && allRecords.length) return;
        allRecords = rows || [];
        recordsCache = {};
        allRecords.forEach(function(r) { if (r['ID']) recordsCache[r['ID']] = r; });
      })
      .withFailureHandler(function() {})
      .getOrders(authToken);
  }

  // ── Drawer ──
  function openDrawer() {
    document.getElementById('drawer').classList.add('open');
    document.getElementById('drawer-overlay').classList.add('open');
  }
  function closeDrawer() {
    document.getElementById('drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('open');
  }

  // ── Versión / actualización de la app ──
  // APP_VERSION viene de js/version.js (se carga antes que este archivo).
  (function initVersionLabel() {
    var el = document.getElementById('drawer-version');
    if (el) el.textContent = 'v' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?');
  })();

  // Si hay un service worker nuevo esperando (ya se bajó pero la pestaña
  // sigue usando el viejo), muestra el badge "Nueva versión" en el drawer.
  function showUpdateBadge() {
    var badge = document.getElementById('drawer-update-badge');
    if (badge) badge.style.display = '';
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(function(reg) {
      if (!reg) return;
      if (reg.waiting) showUpdateBadge();
      reg.addEventListener('updatefound', function() {
        var installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', function() {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBadge();
          }
        });
      });
    }).catch(function() {});
  }

  // Botón "Actualizar app" del drawer: da vuelta el service worker y el
  // caché del app shell, y fuerza una recarga desde la red — así nadie
  // queda pegado con JS/CSS viejos aunque ya hayan instalado la PWA.
  function forceUpdateApp(btnEl) {
    if (btnEl) btnEl.setAttribute('disabled', 'true');
    // El botón del drawer tiene el texto en un <span> aparte (comparte fila con
    // el ícono y el badge); el del modal de actualización obligatoria es texto
    // plano dentro del propio botón.
    var drawerLabel = document.getElementById('drawer-update-label');
    if (drawerLabel) drawerLabel.textContent = 'Actualizando...';
    if (btnEl && btnEl.id === 'update-required-btn') btnEl.textContent = 'Actualizando...';

    var unregisterSw = ('serviceWorker' in navigator)
      ? navigator.serviceWorker.getRegistrations().then(function(regs) {
          return Promise.all(regs.map(function(r) { return r.unregister(); }));
        })
      : Promise.resolve();

    unregisterSw
      .catch(function() {})
      .then(function() {
        if (!window.caches) return;
        return caches.keys().then(function(keys) {
          return Promise.all(keys.map(function(k) { return caches.delete(k); }));
        });
      })
      .catch(function() {})
      .then(function() {
        // cache-busting: evita que el navegador reuse una respuesta HTTP cacheada del index
        var url = window.location.pathname + '?_v=' + Date.now();
        window.location.replace(url);
      });
  }

  // ── Sections (navegación principal desde el drawer) ──
  var SECTIONS = ['inicio', 'pedidos', 'informes', 'usuarios', 'clientes', 'reportes'];
  var currentSection = null;
  // Todos los tab-panel que existen fuera de "Pedidos" (Pedidos tiene los suyos
  // propios manejados por switchTab). Se usa para desactivar todo antes de
  // activar el panel de la sección elegida.
  var NON_PEDIDOS_PANELS = ['inicio', 'nuevo-informe', 'informes', 'mapa', 'usuarios', 'clientes', 'reportes'];

  function switchSection(name, opts) {
    opts = opts || {};
    if (!opts.skipClose) closeDrawer();
    currentSection = name;

    // Marcar item activo en el drawer
    SECTIONS.forEach(function(s) {
      var el = document.getElementById('drawer-' + s);
      if (el) el.classList.toggle('active', s === name);
    });
    // Marcar item activo en los accesos rápidos de abajo (solo cubre Inicio/Pedidos/Informes)
    ['inicio', 'pedidos', 'informes'].forEach(function(s) {
      var el = document.getElementById('bnav-' + s);
      if (el) el.classList.toggle('active', s === name);
    });

    var tabBar = document.getElementById('tab-bar');
    var tabBarInformes = document.getElementById('tab-bar-informes');

    if (name === 'inicio') {
      tabBar.style.display = 'none';
      tabBarInformes.style.display = 'none';
      ['nuevo', 'guardados'].concat(NON_PEDIDOS_PANELS.filter(function(t) { return t !== 'inicio'; }))
        .forEach(function(t) {
          var pb = document.getElementById('panel-' + t);
          if (pb) pb.classList.remove('active');
        });
      document.getElementById('panel-inicio').classList.add('active');
    } else if (name === 'pedidos') {
      tabBar.style.display = '';
      tabBarInformes.style.display = 'none';
      NON_PEDIDOS_PANELS.forEach(function(t) {
        var pb = document.getElementById('panel-' + t);
        if (pb) pb.classList.remove('active');
      });
      switchTab('nuevo');
    } else if (name === 'informes') {
      tabBar.style.display = 'none';
      tabBarInformes.style.display = '';
      ['nuevo', 'guardados'].concat(NON_PEDIDOS_PANELS.filter(function(t) {
        return t !== 'nuevo-informe' && t !== 'informes' && t !== 'mapa';
      })).forEach(function(t) {
        var pb = document.getElementById('panel-' + t);
        if (pb) pb.classList.remove('active');
      });
      switchInformeTab(informesCurrentTab || 'nuevo-informe');
    } else if (name === 'usuarios') {
      tabBar.style.display = 'none';
      tabBarInformes.style.display = 'none';
      ['nuevo', 'guardados'].concat(NON_PEDIDOS_PANELS.filter(function(t) { return t !== 'usuarios'; }))
        .forEach(function(t) {
          var pb = document.getElementById('panel-' + t);
          if (pb) pb.classList.remove('active');
        });
      document.getElementById('panel-usuarios').classList.add('active');
      loadUsers();
    } else if (name === 'clientes') {
      tabBar.style.display = 'none';
      tabBarInformes.style.display = 'none';
      ['nuevo', 'guardados'].concat(NON_PEDIDOS_PANELS.filter(function(t) { return t !== 'clientes'; }))
        .forEach(function(t) {
          var pb = document.getElementById('panel-' + t);
          if (pb) pb.classList.remove('active');
        });
      document.getElementById('panel-clientes').classList.add('active');
      loadClientes();
    } else if (name === 'reportes') {
      tabBar.style.display = 'none';
      tabBarInformes.style.display = 'none';
      ['nuevo', 'guardados'].concat(NON_PEDIDOS_PANELS.filter(function(t) { return t !== 'reportes'; }))
        .forEach(function(t) {
          var pb = document.getElementById('panel-' + t);
          if (pb) pb.classList.remove('active');
        });
      document.getElementById('panel-reportes').classList.add('active');
      loadReportes(false);
    }
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }

  // ────────────────────────────────────────────
  // AUTH ACTIONS
  // ────────────────────────────────────────────
  function doLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    var errEl = document.getElementById('login-error');
    errEl.textContent = '';
    if (!username || !password) { errEl.textContent = 'Ingresá usuario y contraseña.'; return false; }
    var btn = document.getElementById('btn-login');
    btn.disabled = true; btn.textContent = 'Ingresando...';
    google.script.run
      .withSuccessHandler(function(res) {
        btn.disabled = false; btn.textContent = 'Ingresar';
        authToken    = res.token;
        authUsername = res.username;
        authRol      = res.rol;
        authFotoUrl  = res.fotoUrl || '';
        localStorage.setItem('authToken',    authToken);
        localStorage.setItem('authUsername', authUsername);
        localStorage.setItem('authRol',      authRol);
        localStorage.setItem('authFotoUrl',  authFotoUrl);
        launchApp();
      })
      .withFailureHandler(function(err) {
        btn.disabled = false; btn.textContent = 'Ingresar';
        errEl.textContent = err ? err.message : 'Error al iniciar sesión.';
      })
      .login(username, password);
  }

  function doSetup(e) {
    if (e && e.preventDefault) e.preventDefault();
    var username = document.getElementById('setup-username').value.trim();
    var password = document.getElementById('setup-password').value;
    var errEl = document.getElementById('setup-error');
    errEl.textContent = '';
    var btn = document.getElementById('btn-setup');
    btn.disabled = true; btn.textContent = 'Creando...';
    google.script.run
      .withSuccessHandler(function() {
        btn.disabled = false; btn.textContent = 'Crear administrador';
        showScreen('login');
        showToast('Cuenta creada. Ahora podés ingresar.', 'success');
      })
      .withFailureHandler(function(err) {
        btn.disabled = false; btn.textContent = 'Crear administrador';
        errEl.textContent = err ? err.message : 'Error al crear la cuenta.';
      })
      .createInitialAdmin(username, password);
  }

  function doLogout() {
    if (authToken) google.script.run.logout(authToken);
    clearAuth();
    closeDrawer();
    showScreen('login');
  }

  function clearAuth() {
    authToken = null; authUsername = null; authRol = null; authFotoUrl = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUsername');
    localStorage.removeItem('authRol');
    localStorage.removeItem('authFotoUrl');
    resetAppState();
  }

  // Limpia todo el caché en memoria de la sesión anterior. Sin esto, si un Admin cierra sesión
  // y otro usuario (con menos permisos) entra en la misma pestaña, la app seguía mostrando
  // los datos ya cargados del usuario anterior (allRecords, allClients, etc.) hasta hacer F5,
  // porque preloadRecordsCache() y otros solo cargan si el caché está vacío.
  function resetAppState() {
    allRecords = [];
    recordsCache = {};
    allClients = [];
    clientesCache = {};
    editingClienteCodigo = null;
    viewingClienteCodigo = null;
    currentPage = 1;
    sortState = { column: null, direction: 'asc' };
    filterSelections = { 'filter-cliente': [], 'filter-marca': [], 'filter-usuario': [], 'filter-tipo': [], 'filter-zona': [],
      'filter-cliente-ciudad': [], 'filter-cliente-zona': [],
      'if-filter-cliente': [], 'if-filter-usuario': [], 'if-filter-ciudad': [], 'if-filter-zona': [] };
    try { sessionStorage.removeItem(FILTER_STATE_KEY); } catch(e) {}
    allInformes = [];
    informesCache = {};
    viewingInformeId = null;
    editingInformeId = null;
    selectedInformeClienteCodigo = '';
    selectedEditInformeClienteCodigo = '';
    currentInformeLat = null;
    currentInformeLng = null;
    informesCurrentPage = 1;
    informeSortState = { column: null, direction: 'asc' };
    informesCurrentTab = 'nuevo-informe';
  }

  // Wraps failure handlers to catch session expiry
  function handleAuthError(handler) {
    return function(err) {
      if (err && err.message && err.message.indexOf('Sesión expirada') !== -1) {
        clearAuth();
        showToast('Sesión expirada. Ingresá nuevamente.', 'error');
        showScreen('login');
        return;
      }
      if (handler) handler(err);
    };
  }

  // ────────────────────────────────────────────
  // TABS
  // ────────────────────────────────────────────
  // Sub-tabs DENTRO de la sección Pedidos (Nuevo / Guardados)
  function switchTab(name) {
    ['nuevo', 'guardados'].forEach(function(t) {
      var tb = document.getElementById('tab-' + t);
      var pb = document.getElementById('panel-' + t);
      if (tb) tb.classList.toggle('active', t === name);
      if (pb) pb.classList.toggle('active', t === name);
    });
    // Asegurar que los paneles de otras secciones no queden visibles
    ['usuarios', 'clientes', 'reportes', 'nuevo-informe', 'informes', 'mapa'].forEach(function(t) {
      var p = document.getElementById('panel-' + t);
      if (p) p.classList.remove('active');
    });
    // Resetear scroll al cambiar de pestaña
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    if (name === 'guardados') loadRecords();
  }

  // ────────────────────────────────────────────
  // DRAG & DROP / FILE LOAD
  // ────────────────────────────────────────────
  function handleDragOver(e) {
    e.preventDefault();
    document.getElementById('drop-zone').classList.add('dragover');
  }
  function handleDragLeave() {
    document.getElementById('drop-zone').classList.remove('dragover');
  }
  function handleDrop(e) {
    e.preventDefault();
    document.getElementById('drop-zone').classList.remove('dragover');
    var file = e.dataTransfer.files[0];
    if (!file) return;
    var n = (file.name || '').toLowerCase();
    var isAcceptable = file.type.startsWith('image/') || file.type === 'application/pdf'
      || /\.(jpe?g|png|webp|avif|heic|heif|pdf)$/.test(n);
    if (isAcceptable) loadImage(file);
  }
  function handleFileSelect(e) {
    var file = e.target.files[0];
    if (file) loadImage(file);
    // Reset para permitir volver a elegir el mismo archivo si el usuario quiere
    e.target.value = '';
  }

  // Comprime un dataUrl de imagen: redimensiona al lado mayor IMG_MAX_DIM y re-exporta como JPEG.
  // Devuelve { dataUrl, mime, savedKB } — si la salida termina más grande que el original, devuelve el original.
  var IMG_MAX_DIM = 1600;       // píxeles del lado mayor
  var IMG_JPEG_QUALITY = 0.82;  // 0..1
  // opts.autoRotate=true → si la imagen es vertical (alto > ancho), la gira 90° antihorario antes de comprimir.
  // Útil para fotos de pedidos (formularios horizontales) tomadas con el celular en vertical.
  // Los PDFs no usan autoRotate porque pueden tener páginas verticales legítimas.
  function compressDataUrl(dataUrl, opts) {
    opts = opts || {};
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var w = img.naturalWidth, h = img.naturalHeight;
        var rotate = !!opts.autoRotate && h > w;
        var ow = rotate ? h : w;
        var oh = rotate ? w : h;
        var scale = Math.min(1, IMG_MAX_DIM / Math.max(ow, oh));
        var nw = Math.round(ow * scale), nh = Math.round(oh * scale);
        var canvas = document.createElement('canvas');
        canvas.width = nw; canvas.height = nh;
        var ctx = canvas.getContext('2d');
        // Fondo blanco por si la imagen original tenía transparencia (PNG) — JPEG no soporta alpha
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, nw, nh);
        if (rotate) {
          // 90° antihorario: origen al borde inferior izquierdo, luego rotar -90°.
          ctx.translate(0, nh);
          ctx.rotate(-Math.PI / 2);
          ctx.drawImage(img, 0, 0, nh, nw);
        } else {
          ctx.drawImage(img, 0, 0, nw, nh);
        }
        var out = canvas.toDataURL('image/jpeg', IMG_JPEG_QUALITY);
        if (!rotate && out.length >= dataUrl.length) {
          resolve({ dataUrl: dataUrl, mime: detectMimeFromDataUrl(dataUrl) || 'image/jpeg' });
        } else {
          resolve({ dataUrl: out, mime: 'image/jpeg' });
        }
      };
      img.onerror = function() {
        resolve({ dataUrl: dataUrl, mime: detectMimeFromDataUrl(dataUrl) || 'image/jpeg' });
      };
      img.src = dataUrl;
    });
  }

  // Recorta al centro en cuadrado y redimensiona para foto de perfil de usuario
  // (mucho más chica que una foto de pedido — se muestra en un círculo de ~40px).
  var AVATAR_MAX_DIM = 300;
  function compressAvatarDataUrl(dataUrl) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var w = img.naturalWidth, h = img.naturalHeight;
        var side = Math.min(w, h);
        var sx = (w - side) / 2, sy = (h - side) / 2;
        var out = Math.min(AVATAR_MAX_DIM, side);
        var canvas = document.createElement('canvas');
        canvas.width = out; canvas.height = out;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', IMG_JPEG_QUALITY), mime: 'image/jpeg' });
      };
      img.onerror = function() {
        resolve({ dataUrl: dataUrl, mime: detectMimeFromDataUrl(dataUrl) || 'image/jpeg' });
      };
      img.src = dataUrl;
    });
  }

  // Rota 90° antihorario el dataUrl actual y devuelve uno nuevo (JPEG).
  function rotateDataUrlCCW(dataUrl) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var w = img.naturalWidth, h = img.naturalHeight;
        var canvas = document.createElement('canvas');
        canvas.width = h; canvas.height = w;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, h, w);
        ctx.translate(0, w);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', IMG_JPEG_QUALITY));
      };
      img.onerror = function() { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }
  function detectMimeFromDataUrl(dataUrl) {
    var m = /^data:([^;]+);/.exec(dataUrl || '');
    return m ? m[1] : '';
  }

  function loadImage(file) {
    // Tamaño máximo
    if (file.size > 20 * 1024 * 1024) { showToast('El archivo supera los 20 MB', 'error'); return; }

    // Detección por MIME y por extensión (algunos celulares no setean MIME para HEIC)
    var name = (file.name || '').toLowerCase();
    var type = (file.type || '').toLowerCase();
    var isPdf  = type === 'application/pdf' || name.endsWith('.pdf');
    var isHeic = type === 'image/heic' || type === 'image/heif' ||
                 name.endsWith('.heic') || name.endsWith('.heif');
    var isStdImage = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].indexOf(type) !== -1
                  || /\.(jpe?g|png|webp|avif)$/.test(name);

    if (!isPdf && !isHeic && !isStdImage) {
      showToast('Tipo de archivo no soportado. Usá JPG, PNG, WEBP, HEIC, AVIF o PDF.', 'error');
      return;
    }

    if (isPdf) {
      if (typeof pdfjsLib === 'undefined') {
        showToast('Librería PDF no cargada. Verificá tu conexión a internet.', 'error');
        return;
      }
      showToast('Convirtiendo PDF...', 'success');
      pdfToAllPngs(file).then(function(pages) {
        if (!pages.length) {
          showToast('El PDF está vacío.', 'error');
          return;
        }
        // Comprimimos cada página secuencialmente
        return Promise.all(pages.map(function(d) { return compressDataUrl(d); }));
      }).then(function(compressedPages) {
        if (!compressedPages) return; // PDF vacío (ya mostró toast)
        pdfQueue = compressedPages.map(function(c) { return { dataUrl: c.dataUrl, mime: c.mime }; });
        pdfIndex = 0;
        loadQueueItem();
        if (pdfQueue.length > 1) {
          showToast('PDF de ' + pdfQueue.length + ' páginas — vas a cargar ' + pdfQueue.length + ' pedidos uno por uno', 'success');
        }
      }).catch(function(err) {
        showToast('Error al convertir el PDF: ' + (err && err.message ? err.message : 'desconocido'), 'error');
      });
      return;
    }

    if (isHeic) {
      if (typeof heic2any === 'undefined') {
        showToast('Librería HEIC no cargada. Verificá tu conexión a internet.', 'error');
        return;
      }
      showToast('Convirtiendo HEIC...', 'success');
      heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
        .then(function(jpegBlob) {
          var reader = new FileReader();
          reader.onload = function(e) {
            compressDataUrl(e.target.result, { autoRotate: true }).then(function(c) {
              pdfQueue = [{ dataUrl: c.dataUrl, mime: c.mime }];
              pdfIndex = 0;
              loadQueueItem();
            });
          };
          reader.readAsDataURL(jpegBlob);
        })
        .catch(function(err) {
          showToast('Error al convertir el HEIC: ' + (err && err.message ? err.message : 'desconocido'), 'error');
        });
      return;
    }

    // Imagen estándar (JPEG/PNG/WEBP/AVIF) → cola de 1
    // Si el MIME viene vacío del SO, lo deducimos de la extensión para que OpenAI lo acepte
    var resolvedMime = type;
    if (!resolvedMime) {
      if (/\.jpe?g$/.test(name)) resolvedMime = 'image/jpeg';
      else if (/\.png$/.test(name))  resolvedMime = 'image/png';
      else if (/\.webp$/.test(name)) resolvedMime = 'image/webp';
      else if (/\.avif$/.test(name)) resolvedMime = 'image/avif';
      else resolvedMime = 'image/jpeg';
    }
    var reader = new FileReader();
    reader.onload = function(e) {
      compressDataUrl(e.target.result, { autoRotate: true }).then(function(c) {
        pdfQueue = [{ dataUrl: c.dataUrl, mime: c.mime }];
        pdfIndex = 0;
        loadQueueItem();
      });
    };
    reader.readAsDataURL(file);
  }

  // Carga en la UI el item actual de la cola
  function loadQueueItem() {
    if (!pdfQueue.length) return;
    var item = pdfQueue[pdfIndex];
    currentBase64 = item.dataUrl.split(',')[1];
    currentMime = item.mime;
    currentFileId = null; // cada página se sube por separado
    var img = document.getElementById('preview-img');
    img.src = item.dataUrl;
    img.style.display = 'block';
    document.getElementById('placeholder').style.display = 'none';
    document.getElementById('btn-extract').disabled = false;
    var btnRot = document.getElementById('btn-rotate');
    if (btnRot) btnRot.style.display = '';
    var btnClr = document.getElementById('btn-clear-photo');
    if (btnClr) btnClr.style.display = '';
    updateQueueIndicator();
  }

  // Quita la foto cargada (preview + cola + estado) para que el usuario pueda seleccionar otra.
  // NO toca los campos del formulario — si el usuario ya tipeó algo, se preserva.
  function clearPhotoOnly() {
    document.getElementById('preview-img').style.display = 'none';
    document.getElementById('preview-img').src = '';
    document.getElementById('placeholder').style.display = 'flex';
    document.getElementById('btn-extract').disabled = true;
    document.getElementById('file-input').value = ''; // permite re-seleccionar el mismo archivo
    var btnRot = document.getElementById('btn-rotate');
    if (btnRot) btnRot.style.display = 'none';
    var btnClr = document.getElementById('btn-clear-photo');
    if (btnClr) btnClr.style.display = 'none';
    currentBase64 = null; currentMime = null; currentFileId = null;
    pdfQueue = []; pdfIndex = 0;
    updateQueueIndicator();
  }

  // Rota 90° antihorario la imagen actualmente cargada (preview + state + cola PDF).
  // Si ya se subió a Drive, invalidar el fileId para que se vuelva a subir la versión rotada.
  function rotatePreviewCCW() {
    if (!pdfQueue.length) return;
    var item = pdfQueue[pdfIndex];
    var btnRot = document.getElementById('btn-rotate');
    if (btnRot) btnRot.disabled = true;
    rotateDataUrlCCW(item.dataUrl).then(function(newDataUrl) {
      pdfQueue[pdfIndex] = { dataUrl: newDataUrl, mime: 'image/jpeg' };
      currentBase64 = newDataUrl.split(',')[1];
      currentMime = 'image/jpeg';
      currentFileId = null; // la versión vieja en Drive ya no aplica
      document.getElementById('preview-img').src = newDataUrl;
      if (btnRot) btnRot.disabled = false;
    });
  }

  // Actualiza el badge "Pedido X de N" y el estado de los botones Anterior/Siguiente
  function updateQueueIndicator() {
    var ind = document.getElementById('pdf-queue-indicator');
    if (!ind) return;
    if (pdfQueue.length <= 1) {
      ind.style.display = 'none';
    } else {
      ind.style.display = '';
      ind.querySelector('.q-text').textContent = 'Pedido ' + (pdfIndex + 1) + ' de ' + pdfQueue.length;
      var btnPrev = ind.querySelector('.q-prev');
      var btnNext = ind.querySelector('.q-next');
      if (btnPrev) btnPrev.disabled = (pdfIndex <= 0);
      if (btnNext) btnNext.disabled = (pdfIndex >= pdfQueue.length - 1);
    }
  }

  // Avanzar a la siguiente página sin guardar la actual
  function nextQueuePage() {
    if (pdfQueue.length <= 1) return;
    if (pdfIndex >= pdfQueue.length - 1) return;
    pdfIndex++;
    clearFormFieldsOnly();
    loadQueueItem();
    showToast('Mostrando pedido ' + (pdfIndex + 1) + ' de ' + pdfQueue.length, 'success');
  }
  // Volver a la página anterior
  function prevQueuePage() {
    if (pdfQueue.length <= 1) return;
    if (pdfIndex <= 0) return;
    pdfIndex--;
    clearFormFieldsOnly();
    loadQueueItem();
    showToast('Volviste al pedido ' + (pdfIndex + 1) + ' de ' + pdfQueue.length, 'success');
  }

  // ── Visor fullscreen de la foto del pedido (con zoom) ──
  var zoomState = { scale: 1, tx: 0, ty: 0 };
  var ZOOM_DOUBLE_TAP = 2.5;
  var ZOOM_MIN = 1, ZOOM_MAX = 5;
  var lastTapTime = 0, lastTapX = 0, lastTapY = 0;
  var dragState = null;

  function openPhotoViewer(src) {
    if (!src) return;
    document.getElementById('photo-viewer-img').src = src;
    document.getElementById('photo-viewer-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    resetZoom();
    showZoomHint();
    bindViewerDocListeners();
  }
  function openDrivePhoto(fileId) {
    if (!fileId) return;
    var url = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w2000';
    openPhotoViewer(url);
  }
  function closePhotoViewer(e) {
    // Si se clickeó la imagen misma, no cerrar
    if (e && e.target && e.target.id === 'photo-viewer-img') return;
    // Si se estaba arrastrando, no cerrar
    if (e && dragState && dragState.moved) { dragState = null; return; }
    document.getElementById('photo-viewer-overlay').classList.remove('open');
    document.body.style.overflow = '';
    resetZoom();
    unbindViewerDocListeners();
  }
  function resetZoom() {
    zoomState = { scale: 1, tx: 0, ty: 0 };
    applyZoom();
    var ov = document.getElementById('photo-viewer-overlay');
    if (ov) ov.classList.remove('zoomed');
  }
  function applyZoom() {
    var img = document.getElementById('photo-viewer-img');
    if (!img) return;
    img.style.transform = 'translate(' + zoomState.tx + 'px, ' + zoomState.ty + 'px) scale(' + zoomState.scale + ')';
    var ov = document.getElementById('photo-viewer-overlay');
    if (ov) ov.classList.toggle('zoomed', zoomState.scale > 1.01);
  }
  function setZoomAtPoint(newScale, clientX, clientY) {
    newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));
    if (Math.abs(newScale - zoomState.scale) < 0.0001) return;
    var img = document.getElementById('photo-viewer-img');
    var rect = img.getBoundingClientRect();
    var cx = clientX - (rect.left + rect.width / 2);
    var cy = clientY - (rect.top + rect.height / 2);
    var ratio = newScale / zoomState.scale;
    // newTx = tx + cx * (1 - newScale/oldScale)  → mantiene el punto bajo el cursor fijo
    zoomState.tx = zoomState.tx + cx * (1 - ratio);
    zoomState.ty = zoomState.ty + cy * (1 - ratio);
    zoomState.scale = newScale;
    if (newScale <= 1.0001) {
      zoomState.scale = 1; zoomState.tx = 0; zoomState.ty = 0;
    } else {
      clampZoomTranslation();
    }
    applyZoom();
  }
  function clampZoomTranslation() {
    var img = document.getElementById('photo-viewer-img');
    var ov  = document.getElementById('photo-viewer-overlay');
    if (!img || !ov) return;
    var W  = img.clientWidth;
    var H  = img.clientHeight;
    var Vw = ov.clientWidth;
    var Vh = ov.clientHeight;
    var s  = zoomState.scale;
    var extraX = Math.max(0, (W * s - Vw) / 2);
    var extraY = Math.max(0, (H * s - Vh) / 2);
    zoomState.tx = Math.max(-extraX, Math.min(extraX, zoomState.tx));
    zoomState.ty = Math.max(-extraY, Math.min(extraY, zoomState.ty));
  }
  function showZoomHint() {
    var hint = document.getElementById('zoom-hint');
    if (!hint) return;
    hint.classList.remove('hidden');
    clearTimeout(showZoomHint._t);
    showZoomHint._t = setTimeout(function() { hint.classList.add('hidden'); }, 2000);
  }

  // ── Doble-toque (mobile) y doble-click (desktop) ──
  function onViewerImgTouchEnd(e) {
    if (e.changedTouches && e.changedTouches.length > 1) return;
    var t = e.changedTouches ? e.changedTouches[0] : e;
    var now = Date.now();
    var dt = now - lastTapTime;
    var dx = Math.abs(t.clientX - lastTapX);
    var dy = Math.abs(t.clientY - lastTapY);
    if (dt < 350 && dx < 30 && dy < 30) {
      e.preventDefault();
      if (zoomState.scale > 1.01) resetZoom();
      else setZoomAtPoint(ZOOM_DOUBLE_TAP, t.clientX, t.clientY);
      lastTapTime = 0;
    } else {
      lastTapTime = now;
      lastTapX = t.clientX;
      lastTapY = t.clientY;
    }
  }
  function onViewerImgDblClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (zoomState.scale > 1.01) resetZoom();
    else setZoomAtPoint(ZOOM_DOUBLE_TAP, e.clientX, e.clientY);
  }

  // ── Rueda del mouse (desktop) ──
  function onViewerWheel(e) {
    e.preventDefault();
    // Factor exponencial basado en magnitud del scroll → suave y consistente entre dispositivos
    var step = Math.max(-100, Math.min(100, e.deltaY));
    var factor = Math.exp(-step * 0.0012);
    setZoomAtPoint(zoomState.scale * factor, e.clientX, e.clientY);
  }

  // ── Drag para mover cuando está zoomeado ──
  function onViewerImgPointerDown(e) {
    if (zoomState.scale <= 1.01) return;
    // Prevenir el drag-and-drop nativo del browser sobre <img>
    // (sin esto, mouseup no se dispara y dragState queda activo)
    if (e.preventDefault) e.preventDefault();
    var t = e.touches ? e.touches[0] : e;
    dragState = { startX: t.clientX, startY: t.clientY, baseTx: zoomState.tx, baseTy: zoomState.ty, moved: false };
    document.getElementById('photo-viewer-overlay').classList.add('dragging');
  }
  function onViewerImgPointerMove(e) {
    if (!dragState) return;
    var t = e.touches ? e.touches[0] : e;
    var dx = t.clientX - dragState.startX;
    var dy = t.clientY - dragState.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragState.moved = true;
    zoomState.tx = dragState.baseTx + dx;
    zoomState.ty = dragState.baseTy + dy;
    clampZoomTranslation();
    applyZoom();
    if (e.cancelable) e.preventDefault();
  }
  function onViewerImgPointerUp() {
    if (!dragState) return;
    document.getElementById('photo-viewer-overlay').classList.remove('dragging');
    // Si solo fue un tap (no movió), lo dejamos para que onViewerImgTouchEnd haga doble-tap
    setTimeout(function() { dragState = null; }, 0);
  }

  // ── Registro de listeners del viewer ──
  // Los listeners del <img> y del overlay viven mientras el elemento existe (no leakean).
  // Los listeners a nivel `document` (mousemove/mouseup/touchmove/touchend) SÍ se acumulan
  // si no se desligan, así que los bindeamos sólo cuando el viewer está abierto.
  var _viewerDocListenersBound = false;
  function bindViewerDocListeners() {
    if (_viewerDocListenersBound) return;
    document.addEventListener('mousemove', onViewerImgPointerMove);
    document.addEventListener('touchmove', onViewerImgPointerMove, { passive: false });
    document.addEventListener('mouseup', onViewerImgPointerUp);
    document.addEventListener('touchend', onViewerImgPointerUp);
    _viewerDocListenersBound = true;
  }
  function unbindViewerDocListeners() {
    if (!_viewerDocListenersBound) return;
    document.removeEventListener('mousemove', onViewerImgPointerMove);
    document.removeEventListener('touchmove', onViewerImgPointerMove);
    document.removeEventListener('mouseup', onViewerImgPointerUp);
    document.removeEventListener('touchend', onViewerImgPointerUp);
    _viewerDocListenersBound = false;
  }
  document.addEventListener('DOMContentLoaded', function() {
    var img = document.getElementById('photo-viewer-img');
    var ov = document.getElementById('photo-viewer-overlay');
    if (!img || !ov) return;
    // Estos listeners cuelgan del elemento mismo — no son globales, no leakean.
    img.addEventListener('dblclick', onViewerImgDblClick);
    img.addEventListener('touchend', onViewerImgTouchEnd, { passive: false });
    img.addEventListener('mousedown', onViewerImgPointerDown);
    img.addEventListener('touchstart', onViewerImgPointerDown, { passive: true });
    ov.addEventListener('wheel', onViewerWheel, { passive: false });
  });

  // PDF → array de PNGs (uno por página) usando PDF.js
  function pdfToAllPngs(file) {
    return file.arrayBuffer().then(function(buffer) {
      return pdfjsLib.getDocument({ data: buffer }).promise;
    }).then(function(pdf) {
      var pages = [];
      var chain = Promise.resolve();
      var _loop = function(i) {
        chain = chain.then(function() {
          return pdf.getPage(i).then(function(page) {
            var scale = 2.0;
            var viewport = page.getViewport({ scale: scale });
            var canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise
              .then(function() { pages.push(canvas.toDataURL('image/png')); });
          });
        });
      };
      for (var i = 1; i <= pdf.numPages; i++) _loop(i);
      return chain.then(function() { return pages; });
    });
  }

  // ────────────────────────────────────────────
  // EXTRACT (process image)
  // ────────────────────────────────────────────
  function extractData() {
    if (!currentBase64) return;
    setExtracting(true);
    google.script.run
      .withSuccessHandler(function(result) {
        setExtracting(false);
        currentFileId = result.fileId;
        fillForm(result.data);
        showToast('Imagen cargada y datos extraídos', 'success');
      })
      .withFailureHandler(handleAuthError(function(err) {
        setExtracting(false);
        showToast('Error: ' + (err ? err.message : 'desconocido'), 'error');
      }))
      .processImage(authToken, currentBase64, currentMime);
  }

  function setExtracting(on) {
    document.getElementById('btn-extract').disabled = on;
    document.getElementById('spinner').style.display = on ? 'block' : 'none';
    document.getElementById('extract-icon').style.display = on ? 'none' : 'block';
    document.getElementById('extract-label').textContent = on ? 'Cargando...' : 'Cargar';
  }

  function fillForm(data) {
    ['cliente','nroPedido','entrega','direccion','formaPago','nroOrden','marca','totalPares','totalPrecio','obs']
      .forEach(function(f) {
        var el = document.getElementById('f-' + f);
        if (el && data[f] !== undefined) {
          var v = data[f];
          if (f !== 'cliente') v = stripAccents(v);
          if (el.classList.contains('upper')) v = String(v).toUpperCase();
          el.value = v;
          el.classList.toggle('filled', !!v);
        }
      });
    // Intentar auto-match contra la lista de clientes (por razón social o nombre fantasía)
    if (data.cliente) tryAutoMatchCliente(data.cliente);
  }

  function tryAutoMatchCliente(text) {
    var q = String(text).trim().toLowerCase();
    if (!q) return;
    var match = allClients.find(function(c) {
      return String(c.razonSocial || '').toLowerCase() === q
          || String(c.nombreFantasia || '').toLowerCase() === q;
    });
    if (match) selectCliente('f-cliente', match);
  }

  // ────────────────────────────────────────────
  // SAVE ORDER
  // ────────────────────────────────────────────
  function saveOrder() {
    var data = {
      cliente:       val('f-cliente'),
      nroPedido:     stripAccents(val('f-nroPedido')),
      entrega:       stripAccents(val('f-entrega')),
      direccion:     stripAccents(val('f-direccion')),
      ciudad:        val('f-ciudad'),
      formaPago:     stripAccents(val('f-formaPago')),
      tipo:          val('f-tipo'),
      nroOrden:      val('f-nroOrden'),
      marca:         stripAccents(val('f-marca')),
      totalPares:    val('f-totalPares'),
      totalPrecio:   val('f-totalPrecio'),
      obs:           stripAccents(val('f-obs')),
      imageFileId:   currentFileId || '',
      codigoCliente: selectedClienteCodigo || ''
    };
    var missing = [];
    var missingIds = [];
    if (!data.cliente)     { missing.push('Cliente');      missingIds.push('f-cliente'); }
    if (!data.nroOrden)    { missing.push('N° Orden');     missingIds.push('f-nroOrden'); }
    if (!data.tipo)        { missing.push('Tipo');         missingIds.push('f-tipo'); }
    if (!data.marca)       { missing.push('Marca');        missingIds.push('f-marca'); }
    if (!data.totalPares)  { missing.push('Total Pares');  missingIds.push('f-totalPares'); }
    if (!data.totalPrecio) { missing.push('Total Precio'); missingIds.push('f-totalPrecio'); }
    if (missing.length) {
      showToast('Campos obligatorios: ' + missing.join(', '), 'error');
      flashMissingFields(missingIds);
      return;
    }
    // Validación: N° Orden debe ser numérico
    if (!isValidAmount(data.nroOrden)) {
      showToast('N° Orden debe ser un número. No se permiten letras ni símbolos.', 'error');
      document.getElementById('f-nroOrden').focus();
      return;
    }
    // Validación: Total Pares debe ser numérico
    if (!isValidAmount(data.totalPares)) {
      showToast('Total Pares debe ser un número. No se permiten letras ni símbolos.', 'error');
      document.getElementById('f-totalPares').focus();
      return;
    }
    data.totalPares = formatAmount(parseAmount(data.totalPares));
    // Validación: Total Precio debe ser numérico (acepta separadores de miles . o ,)
    if (!isValidAmount(data.totalPrecio)) {
      showToast('Total Precio debe ser un número (ej: 9.661.600). No se permiten letras ni símbolos.', 'error');
      document.getElementById('f-totalPrecio').focus();
      return;
    }
    // Normalizamos con formato latino "9.661.600" para que se vea consistente en el sheet
    data.totalPrecio = formatAmount(parseAmount(data.totalPrecio));
    // Validación: el cliente debe existir (seleccionado del autocomplete)
    if (!data.codigoCliente) {
      showToast('Seleccioná un cliente del listado. Si no existe, primero creálo en Clientes.', 'error');
      document.getElementById('f-cliente').focus();
      return;
    }
    // Validación: la foto es obligatoria
    if (!currentFileId && !currentBase64) {
      showToast('La foto del pedido es obligatoria. Adjuntá una imagen antes de guardar.', 'error');
      document.getElementById('drop-zone').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // Aviso: N° Orden ya existe (permite continuar)
    // Normalizamos quitando ceros iniciales y no-dígitos para que "0011747" == "11747"
    var normOrden = function(v) {
      var s = String(v == null ? '' : v).replace(/\D/g, '');
      s = s.replace(/^0+/, '');
      return s;
    };
    var ordenKey = normOrden(data.nroOrden);
    var existing = ordenKey ? (allRecords || []).filter(function(r) {
      return normOrden(r['N° Orden']) === ordenKey;
    }) : [];
    if (existing.length) {
      var items = existing.slice(0, 3).map(function(r) {
        return (r['Cliente'] || '(sin cliente)') + ' — ' + (r['Fecha Carga'] || 's/f');
      });
      var more = existing.length > 3 ? '…y ' + (existing.length - 3) + ' más' : '';
      var msg = 'El N° Orden ' + ordenKey + ' ya existe (' + existing.length + ' registro' +
                (existing.length > 1 ? 's' : '') + ').';
      showConfirm({
        title: 'N° Orden duplicado',
        message: msg,
        items: items,
        more: more,
        question: '¿Deseás guardar igual?',
        okText: 'Guardar igual',
        cancelText: 'Cancelar'
      }).then(function(ok) {
        if (!ok) {
          document.getElementById('f-nroOrden').focus();
          document.getElementById('f-nroOrden').select();
          return;
        }
        _proceedSave();
      });
      return;
    }
    _proceedSave();

    function _proceedSave() {
    setSaving(true);

    // Si la foto fue seleccionada pero todavía no se subió (usuario no usó "Cargar"),
    // la subimos a Drive primero y luego guardamos el pedido.
    var doSave = function() {
      data.imageFileId = currentFileId || '';
      google.script.run
        .withSuccessHandler(function(res) {
          setSaving(false);
          // ¿Quedan más páginas del PDF en la cola? → avanzar a la siguiente
          if (pdfQueue.length > 1 && pdfIndex < pdfQueue.length - 1) {
            pdfIndex++;
            clearFormFieldsOnly();
            currentFileId = null;
            loadQueueItem();
            showToast('Pedido ' + pdfIndex + '/' + pdfQueue.length + ' guardado. Cargá el siguiente.', 'success');
          } else {
            // Era la única página o la última del PDF → limpiar todo
            if (pdfQueue.length > 1) {
              showToast('¡Cola finalizada! Se guardaron los ' + pdfQueue.length + ' pedidos del PDF.', 'success');
            } else {
              showToast('Pedido guardado — ID: ' + res.id, 'success');
            }
            clearForm();
          }
          google.script.run
            .withSuccessHandler(function(rows) {
              allRecords = rows || [];
              recordsCache = {};
              allRecords.forEach(function(r) { if (r['ID']) recordsCache[r['ID']] = r; });
            })
            .withFailureHandler(function() {})
            .getOrders(authToken);
        })
        .withFailureHandler(handleAuthError(function(err) {
          setSaving(false);
          showToast('Error al guardar: ' + (err ? err.message : ''), 'error');
        }))
        .saveOrder(authToken, data);
    };

    if (!currentFileId && currentBase64) {
      // Subir foto a Drive primero
      document.getElementById('save-label').textContent = 'Subiendo foto...';
      google.script.run
        .withSuccessHandler(function(res) {
          currentFileId = res.fileId;
          document.getElementById('save-label').textContent = 'Guardando...';
          doSave();
        })
        .withFailureHandler(handleAuthError(function(err) {
          setSaving(false);
          showToast('Error subiendo foto: ' + (err ? err.message : ''), 'error');
        }))
        .uploadImageOnly(authToken, currentBase64, currentMime, {
          nroOrden:      data.nroOrden,
          codigoCliente: data.codigoCliente,
          cliente:       data.cliente
        });
    } else {
      doSave();
    }
    } // end _proceedSave
  }

  function val(id) { return document.getElementById(id).value.trim(); }

  function setSaving(on) {
    document.getElementById('btn-save').disabled = on;
    document.getElementById('save-spinner').style.display = on ? 'block' : 'none';
    document.getElementById('save-label').textContent = on ? 'Guardando...' : 'Guardar pedido';
  }

  // Limpia solo los campos del formulario (no la foto, no la cola PDF, no el cliente)
  function clearFormFieldsOnly() {
    ['cliente','nroPedido','entrega','direccion','ciudad','formaPago','tipo','nroOrden','marca','totalPares','totalPrecio','obs']
      .forEach(function(f) {
        var el = document.getElementById('f-' + f);
        if (el) { el.value = ''; el.classList.remove('filled'); }
      });
    clearClienteSelection('f-cliente');
    hideClienteSuggestions('f-cliente');
  }

  function clearForm() {
    clearFormFieldsOnly();
    document.getElementById('preview-img').style.display = 'none';
    document.getElementById('placeholder').style.display = 'flex';
    document.getElementById('btn-extract').disabled = true;
    document.getElementById('file-input').value = '';
    var btnRot = document.getElementById('btn-rotate');
    if (btnRot) btnRot.style.display = 'none';
    var btnClr = document.getElementById('btn-clear-photo');
    if (btnClr) btnClr.style.display = 'none';
    currentBase64 = null; currentMime = null; currentFileId = null;
    pdfQueue = []; pdfIndex = 0;
    updateQueueIndicator();
  }

  // ────────────────────────────────────────────
  // RECORDS
  // ────────────────────────────────────────────
  function loadRecords() {
    setTableLoading('panel-guardados', true);
    google.script.run
      .withSuccessHandler(function(rows) {
        setTableLoading('panel-guardados', false);
        renderRecords(rows || []);
      })
      .withFailureHandler(handleAuthError(function(err) {
        setTableLoading('panel-guardados', false);
        document.getElementById('records-body').innerHTML =
          '<tr><td colspan="7" class="empty-table">Error al cargar: ' + (err ? err.message : 'desconocido') + '</td></tr>';
      }))
      .getOrders(authToken);
  }

  // ── Pagination state ──
  var PAGE_SIZE = 10;
  var currentPage = 1;

  function changePage(delta) {
    currentPage += delta;
    if (currentPage < 1) currentPage = 1;
    applyFilters();
  }

  // ── Sort state ──
  var sortState = { column: null, direction: 'asc' };
  var NUMERIC_COLS = { 'Total Pares': 1, 'Total Precio': 1 };
  var DATE_COLS    = { 'Fecha Carga': 1 };

  function sortBy(key) {
    if (sortState.column === key) {
      sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
      sortState.column = key;
      sortState.direction = 'asc';
    }
    currentPage = 1; // resetear paginación al cambiar orden
    applyFilters();
  }

  function parseDateDMY(s) {
    // dd/MM/yyyy HH:mm  ó  dd/MM/yyyy  ó  dd/MM/yy
    var m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!m) return 0;
    var yr = parseInt(m[3], 10); if (yr < 100) yr += 2000;
    return new Date(yr, parseInt(m[2],10)-1, parseInt(m[1],10), parseInt(m[4]||0,10), parseInt(m[5]||0,10)).getTime();
  }

  function compareRows(a, b, key) {
    var va = a[key], vb = b[key];
    if (NUMERIC_COLS[key]) {
      var na = parseFloat(String(va || '').replace(/[.,\s]/g, '')) || 0;
      var nb = parseFloat(String(vb || '').replace(/[.,\s]/g, '')) || 0;
      return na - nb;
    }
    if (DATE_COLS[key]) return parseDateDMY(va) - parseDateDMY(vb);
    return String(va || '').toLowerCase().localeCompare(String(vb || '').toLowerCase(), 'es');
  }

  function updateSortIndicators() {
    var inds = document.querySelectorAll('.sort-ind');
    inds.forEach(function(el) {
      if (el.getAttribute('data-key') === sortState.column) {
        el.classList.add('active');
        el.textContent = sortState.direction === 'asc' ? '▲' : '▼';
      } else {
        el.classList.remove('active');
        el.textContent = '⇅';
      }
    });
  }

  function renderRecords(rows) {
    allRecords = rows;
    recordsCache = {};
    rows.forEach(function(r) { if (r['ID']) recordsCache[r['ID']] = r; });
    currentPage = 1; // resetear paginación al recargar

    // Restaurar filtros + sort + página (antes de poblar opciones para que el active class quede correcto)
    var restored = restoreFilterState();

    // Poblar filtros (Usuario, Marca, Cliente) — toma valores únicos del dataset
    populateSelectFilter('filter-usuario', rows, 'Usuario', 'Todos los usuarios');
    populateSelectFilter('filter-marca',   rows, 'Marca',   'Todas las marcas');
    populateSelectFilter('filter-cliente', rows, 'Cliente', 'Todos los clientes');
    populateSelectFilter('filter-tipo',    rows, 'Tipo',    'Todos los tipos');
    populateSelectFilter('filter-zona',    rows, 'Zona',    'Todas las zonas');
    updateFiltersCount();
    if (restored) updateSortIndicators();

    applyFilters();
    var dupCount = updateDuplicatesKpi();
    if (dupCount > 0) {
      var msg = dupCount === 1
        ? '⚠ Atención: el N° Orden ' + getRelevantDuplicates()[0] + ' está duplicado.'
        : '⚠ Atención: hay ' + dupCount + ' N° Orden duplicados.';
      showToast(msg, 'warning');
    }
  }

  // Devuelve los N° Orden duplicados que el usuario actual TIENE PERMISO de ver.
  // - Admin: todos los duplicados globales.
  // - Usuario normal: solo aquellos donde al menos uno de los registros le pertenece.
  function getRelevantDuplicates() {
    var counts = {};
    allRecords.forEach(function(r) {
      var k = String(r['N° Orden'] || '').trim();
      if (!k) return;
      counts[k] = (counts[k] || 0) + 1;
    });
    var dupOrders = Object.keys(counts).filter(function(k) { return counts[k] > 1; });
    if (!dupOrders.length) return [];
    if (authRol === 'Admin' || authRol === 'AdminL') return dupOrders;
    return dupOrders.filter(function(orden) {
      return allRecords.some(function(r) {
        return String(r['N° Orden'] || '').trim() === orden && r['Usuario'] === authUsername;
      });
    });
  }

  // Actualiza la KPI card "N° Orden duplicados". La oculta si no hay ninguno.
  // Retorna la cantidad (para que el caller pueda decidir si mostrar también un toast).
  function updateDuplicatesKpi() {
    var dups = getRelevantDuplicates();
    var card = document.getElementById('kpi-dup-card');
    var val  = document.getElementById('kpi-dup');
    if (!card || !val) return dups.length;
    if (dups.length === 0) {
      card.style.display = 'none';
    } else {
      card.style.display = '';
      val.textContent = dups.length;
    }
    return dups.length;
  }

  // Estado de selección multi por filtro (arrays de valores)
  var filterSelections = { 'filter-cliente': [], 'filter-marca': [], 'filter-usuario': [], 'filter-tipo': [], 'filter-zona': [],
    'filter-cliente-ciudad': [], 'filter-cliente-zona': [] };

  function populateSelectFilter(selectId, rows, key, allLabel) {
    var values = [];
    rows.forEach(function(r) {
      var v = r[key];
      if (v && values.indexOf(v) === -1) values.push(v);
    });
    values.sort(function(a, b) {
      return String(a).localeCompare(String(b), 'es', { sensitivity: 'base' });
    });
    var hidden = document.getElementById(selectId);
    if (!hidden) return;
    var sdrop = hidden.closest('.sdrop');
    // Limpiar selecciones cuyo valor ya no exista en el dataset
    var selected = (filterSelections[selectId] || []).filter(function(v) {
      return values.indexOf(v) !== -1;
    });
    filterSelections[selectId] = selected;
    var optsEl = sdrop.querySelector('.sdrop-options');
    // Item especial "Limpiar selección" arriba del listado
    var html = '<button type="button" class="sdrop-clear" data-value="__clear__" onclick="clearSdropSelection(this)">Limpiar selección</button>';
    html += values.map(function(v) {
      var isOn = selected.indexOf(v) !== -1;
      return '<button type="button" class="sdrop-option' + (isOn ? ' active' : '') +
             '" data-value="' + esc(v) + '" onclick="toggleSdropOption(this)">' +
             '<span class="sdrop-check">' + (isOn ? '✓' : '') + '</span>' +
             '<span class="sdrop-text">' + esc(v) + '</span>' +
             '</button>';
    }).join('');
    optsEl.innerHTML = html;
    sdrop.dataset.allLabel = allLabel;
    updateSdropLabel(sdrop);
  }

  // Actualiza el texto del botón principal del sdrop según cuántos están seleccionados
  function updateSdropLabel(sdrop) {
    var hidden = sdrop.querySelector('input[type="hidden"]');
    var selected = filterSelections[hidden.id] || [];
    var lbl = sdrop.querySelector('.sdrop-label');
    var allLabel = sdrop.dataset.allLabel || '—';
    if (selected.length === 0) {
      lbl.textContent = allLabel;
    } else if (selected.length === 1) {
      lbl.textContent = selected[0];
    } else {
      lbl.textContent = selected.length + ' seleccionados';
    }
    sdrop.classList.toggle('has-value', selected.length > 0);
  }

  // ── Searchable dropdown handlers ──
  // El panel de filtros se posiciona con "right:0" relativo a su botón. Si ese
  // botón queda cerca del borde izquierdo de la pantalla (poco espacio a la
  // derecha, como en el toolbar de Mapa) el panel se sale del viewport. Esto
  // lo re-ancla con un left explícito para que quede siempre visible.
  function keepFiltersPanelInViewport(panel) {
    // Reset de left/right antes de medir: si una apertura anterior dejó
    // right:auto puesto, la siguiente medición parte de un estado distinto
    // al CSS original y da resultados inconsistentes (por eso alternaba
    // bien/mal entre aperturas).
    panel.style.left = '';
    panel.style.right = '';
    var margin = 12;
    var rect = panel.getBoundingClientRect();
    if (rect.left < margin) {
      panel.style.left = (panel.offsetLeft + (margin - rect.left)) + 'px';
      panel.style.right = 'auto';
    } else {
      panel.style.right = '';
    }
  }
  function toggleFiltersPanel(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    var panel = document.getElementById('filters-panel');
    var btn = document.getElementById('btn-filters');
    var willShow = panel.hasAttribute('hidden');
    if (willShow) { panel.removeAttribute('hidden'); btn.classList.add('active'); keepFiltersPanelInViewport(panel); }
    else          { panel.setAttribute('hidden', ''); btn.classList.remove('active'); closeAllSdrops(); }
  }
  function closeFiltersPanel() {
    var panel = document.getElementById('filters-panel');
    var btn = document.getElementById('btn-filters');
    if (panel && !panel.hasAttribute('hidden')) {
      panel.setAttribute('hidden', '');
      btn.classList.remove('active');
      closeAllSdrops();
    }
  }
  // ── Filtros de Clientes (Ciudad / Zona) ──
  function toggleClienteFiltersPanel(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    var panel = document.getElementById('filters-panel-clientes');
    var btn = document.getElementById('btn-filters-clientes');
    var willShow = panel.hasAttribute('hidden');
    if (willShow) { panel.removeAttribute('hidden'); btn.classList.add('active'); keepFiltersPanelInViewport(panel); }
    else          { panel.setAttribute('hidden', ''); btn.classList.remove('active'); closeAllSdrops(); }
  }
  function clearClienteFilters() {
    ['filter-cliente-ciudad', 'filter-cliente-zona'].forEach(function(id) {
      filterSelections[id] = [];
      var hidden = document.getElementById(id);
      if (!hidden) return;
      var sdrop = hidden.closest('.sdrop');
      sdrop.querySelectorAll('.sdrop-option').forEach(function(o) {
        o.classList.remove('active');
        var ck = o.querySelector('.sdrop-check'); if (ck) ck.textContent = '';
      });
      updateSdropLabel(sdrop);
    });
    document.getElementById('search-clientes').value = '';
    updateClienteFiltersCount();
    renderClientes();
  }
  function updateClienteFiltersCount() {
    var n = 0;
    ['filter-cliente-ciudad', 'filter-cliente-zona'].forEach(function(id) {
      if ((filterSelections[id] || []).length > 0) n++;
    });
    var badge = document.getElementById('filters-count-clientes');
    if (!badge) return;
    if (n > 0) { badge.style.display = ''; badge.textContent = n; }
    else        { badge.style.display = 'none'; }
  }
  // Cerrar popover al click fuera del wrapper (soporta varios .filters-wrap en la página)
  document.addEventListener('click', function(e) {
    document.querySelectorAll('.filters-wrap').forEach(function(wrap) {
      if (wrap.contains(e.target)) return;
      var panel = wrap.querySelector('.filters-panel');
      var btn = wrap.querySelector('.btn-filters');
      if (panel && !panel.hasAttribute('hidden')) {
        panel.setAttribute('hidden', '');
        if (btn) btn.classList.remove('active');
        closeAllSdrops();
      }
    });
  });
  function toggleSdrop(btn) {
    var sdrop = btn.closest('.sdrop');
    var panel = sdrop.querySelector('.sdrop-panel');
    var isOpen = sdrop.classList.contains('open');
    closeAllSdrops();
    if (!isOpen) {
      sdrop.classList.add('open');
      panel.removeAttribute('hidden');
      var search = panel.querySelector('.sdrop-search');
      search.value = '';
      filterSdropOptions(search);
      setTimeout(function() { search.focus(); }, 0);
    }
  }
  function closeAllSdrops() {
    document.querySelectorAll('.sdrop.open').forEach(function(sd) {
      sd.classList.remove('open');
      var p = sd.querySelector('.sdrop-panel');
      if (p) p.setAttribute('hidden', '');
    });
  }
  function filterSdropOptions(input) {
    var q = input.value.toLowerCase().trim();
    var opts = input.parentElement.querySelectorAll('.sdrop-option');
    var visible = 0;
    opts.forEach(function(o) {
      var match = !q || o.textContent.toLowerCase().indexOf(q) !== -1;
      o.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    // Mensaje vacío
    var optsEl = input.parentElement.querySelector('.sdrop-options');
    var empty = optsEl.querySelector('.sdrop-empty');
    if (visible === 0) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'sdrop-empty';
        empty.textContent = 'Sin coincidencias';
        optsEl.appendChild(empty);
      }
    } else if (empty) {
      empty.remove();
    }
  }
  // Toggle on/off de una opción en multi-select
  function toggleSdropOption(btn) {
    var sdrop = btn.closest('.sdrop');
    var hidden = sdrop.querySelector('input[type="hidden"]');
    var value = btn.dataset.value || '';
    var selected = filterSelections[hidden.id] || [];
    var idx = selected.indexOf(value);
    if (idx === -1) {
      selected.push(value);
      btn.classList.add('active');
      btn.querySelector('.sdrop-check').textContent = '✓';
    } else {
      selected.splice(idx, 1);
      btn.classList.remove('active');
      btn.querySelector('.sdrop-check').textContent = '';
    }
    filterSelections[hidden.id] = selected;
    updateSdropLabel(sdrop);
    onSdropFilterChanged(sdrop);
    // NO cerramos el dropdown — el usuario puede seguir eligiendo más
  }
  // Limpia todas las selecciones de este sdrop
  function clearSdropSelection(btn) {
    var sdrop = btn.closest('.sdrop');
    var hidden = sdrop.querySelector('input[type="hidden"]');
    filterSelections[hidden.id] = [];
    sdrop.querySelectorAll('.sdrop-option').forEach(function(o) {
      o.classList.remove('active');
      var ck = o.querySelector('.sdrop-check'); if (ck) ck.textContent = '';
    });
    updateSdropLabel(sdrop);
    onSdropFilterChanged(sdrop);
  }
  // Dispara el recálculo correcto (Pedidos o Clientes) según a qué panel pertenece el sdrop
  function onSdropFilterChanged(sdrop) {
    if (sdrop.closest('#filters-panel-clientes')) {
      updateClienteFiltersCount();
      renderClientes();
    } else if (sdrop.closest('#if-filters-panel')) {
      updateInformeFiltersCount();
      onInformeFilterChange();
    } else {
      updateFiltersCount();
      onFilterChange();
    }
  }
  function clearAllFilters() {
    ['filter-cliente','filter-marca','filter-usuario','filter-tipo','filter-zona'].forEach(function(id) {
      filterSelections[id] = [];
      var hidden = document.getElementById(id);
      if (!hidden) return;
      var sdrop = hidden.closest('.sdrop');
      sdrop.querySelectorAll('.sdrop-option').forEach(function(o) {
        o.classList.remove('active');
        var ck = o.querySelector('.sdrop-check'); if (ck) ck.textContent = '';
      });
      updateSdropLabel(sdrop);
    });
    document.getElementById('search-input').value = '';
    var fd = document.getElementById('filter-fecha-desde'); if (fd) fd.value = '';
    var fh = document.getElementById('filter-fecha-hasta'); if (fh) fh.value = '';
    sortState = { column: null, direction: 'asc' };
    try { sessionStorage.removeItem(FILTER_STATE_KEY); } catch(e) {}
    updateFiltersCount();
    onFilterChange();
  }
  function updateFiltersCount() {
    var n = 0;
    ['filter-cliente','filter-marca','filter-usuario','filter-tipo','filter-zona'].forEach(function(id) {
      if ((filterSelections[id] || []).length > 0) n++;
    });
    // Rango de fechas cuenta como 1 si hay al menos un extremo seteado
    var fd = document.getElementById('filter-fecha-desde');
    var fh = document.getElementById('filter-fecha-hasta');
    if ((fd && fd.value) || (fh && fh.value)) n++;
    var badge = document.getElementById('filters-count');
    if (n > 0) { badge.style.display = ''; badge.textContent = n; }
    else        { badge.style.display = 'none'; }
  }
  // Cerrar dropdowns al click afuera
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.sdrop')) closeAllSdrops();
  });

  // Convierte "9.661.600" o "9,661,600" o "9661600" a número
  function parseAmount(s) {
    if (s === null || s === undefined) return 0;
    var str = String(s).trim();
    if (!str) return 0;
    // Remueve todo lo que no sea dígito ni coma decimal; los separadores de miles (puntos/comas) se eliminan
    // Asumimos formato latino: punto/coma como separador de miles, sin decimales en Total Precio
    var n = parseFloat(str.replace(/[^\d-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function formatAmount(n) {
    // Formato latino con puntos como separador de miles
    return Math.round(n).toLocaleString('es-PY').replace(/,/g, '.');
  }
  function formatAmountInput(input) {
    var raw = input.value.replace(/[^\d]/g, '');
    if (!raw) { input.value = ''; return; }
    input.value = parseInt(raw, 10).toLocaleString('es-PY').replace(/,/g, '.');
  }
  // Valida que un string represente un monto numérico válido:
  // permite dígitos, puntos y comas como separadores de miles. Rechaza letras/símbolos.
  function isValidAmount(s) {
    var str = String(s == null ? '' : s).trim();
    if (!str) return false;
    if (!/^[\d.,\s]+$/.test(str)) return false;       // solo dígitos y separadores
    var digits = str.replace(/[^\d]/g, '');
    return digits.length > 0 && parseInt(digits, 10) > 0;
  }

  // Normaliza el campo Marca: mayúsculas + sin acentos / diacríticos. La Ñ se preserva.
  function normalizeMarca(s) {
    return stripAccents(s).toUpperCase();
  }

  // Quita acentos/diacríticos (á→a, ñ→n, etc.) — usado en los campos de carga de pedidos
  // para evitar inconsistencias de tildes entre distintos usuarios cargando el mismo dato.
  function stripAccents(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function onFilterChange() {
    currentPage = 1;
    applyFilters();
  }

  // ── Esc global: cierra el modal/viewer abierto más alto ──
  // El photo viewer tiene prioridad; si no, cierra el último modal-overlay visible.
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    var pv = document.getElementById('photo-viewer-overlay');
    if (pv && pv.classList.contains('open')) { closePhotoViewer(); return; }
    var open = Array.prototype.slice.call(document.querySelectorAll('.modal-overlay:not(.hidden)'));
    if (open.length) {
      var top = open[open.length - 1];
      var cancelBtn = top.querySelector('.btn-modal-cancel');
      if (cancelBtn) cancelBtn.click();
    }
  });

  // Foco al primer campo editable de un modal recién abierto.
  function focusFirstField(modalEl) {
    if (!modalEl) return;
    setTimeout(function() {
      var first = modalEl.querySelector('input:not([type=hidden]):not([disabled]):not([readonly]), textarea, select');
      if (first) first.focus();
    }, 60);
  }

  // Persistencia de filtros + sort + página en sessionStorage (sobrevive reload, no entre pestañas)
  var FILTER_STATE_KEY = 'pedidos.filterState.v1';
  function saveFilterState() {
    try {
      var fd = document.getElementById('filter-fecha-desde');
      var fh = document.getElementById('filter-fecha-hasta');
      var si = document.getElementById('search-input');
      sessionStorage.setItem(FILTER_STATE_KEY, JSON.stringify({
        filterSelections: filterSelections,
        search:    si ? si.value : '',
        dateFrom:  fd ? fd.value : '',
        dateTo:    fh ? fh.value : '',
        sortState: sortState,
        currentPage: currentPage
      }));
    } catch(e) {}
  }
  function restoreFilterState() {
    try {
      var raw = sessionStorage.getItem(FILTER_STATE_KEY);
      if (!raw) return false;
      var s = JSON.parse(raw);
      if (s.filterSelections) {
        filterSelections = s.filterSelections;
        // Re-pintar los checks de los sdrops según selecciones restauradas
        Object.keys(filterSelections).forEach(function(id) {
          var hidden = document.getElementById(id);
          if (!hidden) return;
          var sdrop = hidden.closest('.sdrop');
          if (!sdrop) return;
          var selected = filterSelections[id] || [];
          sdrop.querySelectorAll('.sdrop-option').forEach(function(o) {
            var v = o.dataset.value || '';
            var isOn = selected.indexOf(v) !== -1;
            o.classList.toggle('active', isOn);
            var ck = o.querySelector('.sdrop-check'); if (ck) ck.textContent = isOn ? '✓' : '';
          });
          updateSdropLabel(sdrop);
        });
      }
      var si = document.getElementById('search-input');
      if (si && typeof s.search === 'string') si.value = s.search;
      var fd = document.getElementById('filter-fecha-desde'); if (fd && s.dateFrom) fd.value = s.dateFrom;
      var fh = document.getElementById('filter-fecha-hasta'); if (fh && s.dateTo)   fh.value = s.dateTo;
      if (s.sortState && s.sortState.column) sortState = s.sortState;
      if (typeof s.currentPage === 'number' && s.currentPage > 0) currentPage = s.currentPage;
      updateFiltersCount();
      return true;
    } catch(e) { return false; }
  }

  // Spinner overlay sobre el panel de una tabla mientras se hace fetch
  function setTableLoading(panelId, isLoading) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    var existing = panel.querySelector('.table-loading-overlay');
    if (isLoading) {
      if (existing) return;
      var ov = document.createElement('div');
      ov.className = 'table-loading-overlay';
      ov.innerHTML = '<div class="spinner"></div><span>Cargando…</span>';
      panel.appendChild(ov);
    } else if (existing) {
      existing.remove();
    }
  }

  // Debounce genérico (compartido para input de texto del buscador y filtros)
  function debounce(fn, ms) {
    var t;
    return function() {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function(){ fn.apply(ctx, args); }, ms);
    };
  }
  var debouncedFilterChange = debounce(onFilterChange, 300);

  function getFilteredSortedRecords() {
    var q = (document.getElementById('search-input').value || '').toLowerCase().trim();
    var usuarios = filterSelections['filter-usuario'] || [];
    var marcas   = filterSelections['filter-marca']   || [];
    var clientes = filterSelections['filter-cliente'] || [];
    var tipos    = filterSelections['filter-tipo']    || [];
    var zonas    = filterSelections['filter-zona']    || [];
    var fDesde   = document.getElementById('filter-fecha-desde').value; // "yyyy-MM-dd" o ""
    var fHasta   = document.getElementById('filter-fecha-hasta').value;
    // Convertir desde/hasta a número (timestamp del día completo)
    var tsDesde = fDesde ? new Date(fDesde + 'T00:00:00').getTime() : null;
    var tsHasta = fHasta ? new Date(fHasta + 'T23:59:59').getTime() : null;
    var filtered = allRecords.filter(function(r) {
      if (usuarios.length && usuarios.indexOf(r['Usuario']) === -1) return false;
      if (marcas.length   && marcas.indexOf(r['Marca'])     === -1) return false;
      if (clientes.length && clientes.indexOf(r['Cliente']) === -1) return false;
      if (tipos.length    && tipos.indexOf(r['Tipo'])       === -1) return false;
      if (zonas.length    && zonas.indexOf(r['Zona'])       === -1) return false;
      if (tsDesde !== null || tsHasta !== null) {
        var rTs = parseDateDMY(r['Fecha Carga']);
        if (!rTs) return false;
        if (tsDesde !== null && rTs < tsDesde) return false;
        if (tsHasta !== null && rTs > tsHasta) return false;
      }
      if (!q) return true;
      return ['Cliente','N° Orden','N° Pedido','Marca','Ciudad','RUC','Usuario','Código Cliente'].some(function(k) {
        return (r[k] || '').toLowerCase().indexOf(q) !== -1;
      });
    });
    if (sortState.column) {
      filtered = filtered.slice().sort(function(a, b) {
        var c = compareRows(a, b, sortState.column);
        return sortState.direction === 'asc' ? c : -c;
      });
    }
    return filtered;
  }

  function exportToExcel() {
    var rows = getFilteredSortedRecords();
    if (!rows.length) { showToast('No hay registros para exportar', 'error'); return; }
    var cols = ['Fecha Carga','N° Orden','Código Cliente','Cliente','RUC','N° Pedido','Entrega',
                'Dirección','Ciudad','Zona','Forma Pago','Tipo','Marca','Total Pares','Total Precio',
                'OBS','Usuario'];
    function csvCell(v) {
      var s = (v === null || v === undefined) ? '' : String(v);
      if (/[",;\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var lines = [cols.map(csvCell).join(';')];
    rows.forEach(function(r) {
      lines.push(cols.map(function(c) { return csvCell(r[c]); }).join(';'));
    });
    // BOM UTF-8 para que Excel respete acentos y la ñ
    var csv = '﻿' + lines.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var ts = new Date();
    var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    var fname = 'pedidos_' + ts.getFullYear() + pad(ts.getMonth()+1) + pad(ts.getDate()) +
                '_' + pad(ts.getHours()) + pad(ts.getMinutes()) + '.csv';
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    showToast('Exportados ' + rows.length + ' registros', 'success');
  }

  // Exporta los informes de visitas filtrados/ordenados (misma logica que
  // exportToExcel de Pedidos, pero con las columnas de Informes).
  function exportInformesToExcel() {
    var rows = getFilteredSortedInformes();
    if (!rows.length) { showToast('No hay registros para exportar', 'error'); return; }
    var cols = ['Fecha', 'Cliente', 'Código Cliente', 'Ciudad', 'Zona', 'Comentario',
                'Latitud', 'Longitud', 'Usuario'];
    function csvCell(v) {
      var s = (v === null || v === undefined) ? '' : String(v);
      if (/[",;\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var lines = [cols.map(csvCell).join(';')];
    rows.forEach(function(r) {
      lines.push(cols.map(function(c) { return csvCell(r[c]); }).join(';'));
    });
    var csv = '﻿' + lines.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var ts = new Date();
    var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    var fname = 'informes_' + ts.getFullYear() + pad(ts.getMonth()+1) + pad(ts.getDate()) +
                '_' + pad(ts.getHours()) + pad(ts.getMinutes()) + '.csv';
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    showToast('Exportados ' + rows.length + ' registros', 'success');
  }

  function applyFilters() {
    saveFilterState();
    var filtered = getFilteredSortedRecords();

    // ── KPIs (sobre el conjunto filtrado, ignorando paginación) ──
    var sumTotal = 0, sumPares = 0;
    filtered.forEach(function(r) {
      sumTotal += parseAmount(r['Total Precio']);
      sumPares += parseAmount(r['Total Pares']);
    });
    document.getElementById('kpi-count').textContent = filtered.length;
    document.getElementById('kpi-pares').textContent = formatAmount(sumPares);
    document.getElementById('kpi-total').textContent = 'Gs. ' + formatAmount(sumTotal);
    updateSortIndicators();

    // ── Paginación ──
    var totalRows = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    var startIdx = (currentPage - 1) * PAGE_SIZE;
    var endIdx = Math.min(startIdx + PAGE_SIZE, totalRows);
    var pageRows = filtered.slice(startIdx, endIdx);

    var pagBar = document.getElementById('pagination-bar');
    if (totalRows > 0) {
      pagBar.style.display = '';
      document.getElementById('pagination-info').textContent =
        'Mostrando ' + (startIdx + 1) + '–' + endIdx + ' de ' + totalRows;
      document.getElementById('pagination-page').textContent = currentPage + ' / ' + totalPages;
      document.getElementById('btn-page-prev').disabled = currentPage <= 1;
      document.getElementById('btn-page-next').disabled = currentPage >= totalPages;
    } else {
      pagBar.style.display = 'none';
    }

    var tbody = document.getElementById('records-body');
    if (!filtered.length) {
      var hasAnyFilter = (document.getElementById('search-input').value || '').trim() ||
                        (filterSelections['filter-usuario'] || []).length ||
                        (filterSelections['filter-marca']   || []).length ||
                        (filterSelections['filter-cliente'] || []).length ||
                        (filterSelections['filter-tipo']    || []).length ||
                        (filterSelections['filter-zona']    || []).length ||
                        document.getElementById('filter-fecha-desde').value ||
                        document.getElementById('filter-fecha-hasta').value;
      tbody.innerHTML = '<tr><td colspan="7" class="empty-table">' +
        (hasAnyFilter ? 'Sin resultados para los filtros aplicados' : 'No hay pedidos guardados aún') +
        '</td></tr>';
      return;
    }
    filtered = pageRows; // a partir de acá, el render usa solo la página actual
    // Detectar N° Orden duplicados — alcance global (sobre TODOS los registros, no solo la página)
    var ordenCounts = {};
    allRecords.forEach(function(rec) {
      var k = String(rec['N° Orden'] || '').trim();
      if (!k) return;
      ordenCounts[k] = (ordenCounts[k] || 0) + 1;
    });
    tbody.innerHTML = filtered.map(function(r) {
      var rid = esc(r['ID']);
      var selectedClass = (selectedRowId === r['ID']) ? ' class="row-selected"' : '';
      // Marca de duplicado en N° Orden
      var ordenKey = String(r['N° Orden'] || '').trim();
      var dupCount = ordenKey ? (ordenCounts[ordenKey] || 0) : 0;
      var dupBadge = dupCount > 1
        ? '<span class="dup-warning" title="Este N° Orden aparece ' + dupCount + ' veces" aria-label="Duplicado">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
          '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' +
          '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' +
          '</svg></span>'
        : '';
      return '<tr data-id="' + rid + '" tabindex="0" role="button" aria-label="Ver pedido" ' +
        'onclick="selectRow(\'' + rid + '\');openViewModal(\'' + rid + '\')" ' +
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();selectRow(\'' + rid + '\');openViewModal(\'' + rid + '\');}"' +
        selectedClass + '>' +
        '<td>' + dupBadge + esc(r['N° Orden']) + '</td>' +
        '<td>' + esc(r['Fecha Carga']) + '</td>' +
        '<td title="' + esc(r['Cliente']) + '">' + esc(r['Cliente']) + '</td>' +
        '<td>' + esc(r['Ciudad']) + '</td>' +
        '<td>' + esc(r['Marca']) + '</td>' +
        '<td class="username-display">' + esc(r['Usuario']) + '</td>' +
        '<td style="text-align:right;font-weight:600">' + esc(r['Total Precio']) + '</td>' +
      '</tr>';
    }).join('');
  }

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ────────────────────────────────────────────
  // VIEW ORDER (solo lectura, todos los usuarios)
  // ────────────────────────────────────────────
  var viewingId = null;

  function openViewModal(id) {
    var r = recordsCache[id];
    if (!r) return;
    viewingId = id;
    document.getElementById('view-record-id').textContent = 'ID: ' + id;
    // Foto del pedido (si existe en Drive)
    var imgId = String(r['Imagen'] || '').trim();
    var photoWrap  = document.getElementById('v-photo-wrap');
    var photoEmpty = document.getElementById('v-photo-empty');
    var photoImg   = document.getElementById('v-photo-thumb');
    if (imgId) {
      photoImg.src = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(imgId) + '&sz=w2000';
      photoWrap.style.display = '';
      photoEmpty.style.display = 'none';
    } else {
      photoImg.src = '';
      photoWrap.style.display = 'none';
      photoEmpty.style.display = '';
    }
    document.getElementById('v-cliente').textContent     = r['Cliente']     || '';
    document.getElementById('v-usuario').textContent     = r['Usuario']     || '';
    document.getElementById('v-nroOrden').textContent    = r['N° Orden']    || '';
    document.getElementById('v-nroPedido').textContent   = r['N° Pedido']   || '';
    document.getElementById('v-entrega').textContent     = r['Entrega']     || '';
    document.getElementById('v-ciudad').textContent      = r['Ciudad']      || '';
    document.getElementById('v-zona').textContent        = r['Zona']        || '';
    document.getElementById('v-direccion').textContent   = r['Dirección']   || '';
    document.getElementById('v-formaPago').textContent   = r['Forma Pago']  || '';
    document.getElementById('v-tipo').textContent        = r['Tipo']        || '';
    document.getElementById('v-marca').textContent       = r['Marca']       || '';
    document.getElementById('v-totalPares').textContent  = r['Total Pares'] || '';
    document.getElementById('v-totalPrecio').textContent = r['Total Precio']|| '';
    document.getElementById('v-obs').textContent         = r['OBS']         || '';
    // Badge con el código de cliente (si el pedido lo tiene guardado)
    var codCli = String(r['Código Cliente'] || '').trim();
    var badge = document.getElementById('v-cliente-codigo-badge');
    if (codCli) {
      badge.textContent = codCli;
      badge.className = 'cliente-badge';
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
      badge.textContent = '';
    }
    // El botón "Editar" del modal Ver es admin-only
    document.getElementById('btn-view-edit').style.display   = (authRol === 'Admin') ? '' : 'none';
    document.getElementById('btn-view-delete').style.display = (authRol === 'Admin') ? '' : 'none';
    updateViewNavState();
    document.getElementById('modal-view-overlay').classList.remove('hidden');
  }

  function getViewNavList() {
    try { return getFilteredSortedRecords() || []; } catch(e) { return []; }
  }

  function updateViewNavState() {
    var list = getViewNavList();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i]['ID'] === viewingId) { idx = i; break; }
    }
    var prevBtn = document.getElementById('view-prev-btn');
    var nextBtn = document.getElementById('view-next-btn');
    var posEl   = document.getElementById('view-nav-pos');
    if (idx === -1 || list.length === 0) {
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      if (posEl)   posEl.textContent = '';
      return;
    }
    if (prevBtn) prevBtn.disabled = (idx === 0);
    if (nextBtn) nextBtn.disabled = (idx === list.length - 1);
    if (posEl)   posEl.textContent = (idx + 1) + ' / ' + list.length;
  }

  function navigateView(direction) {
    if (!viewingId) return;
    var list = getViewNavList();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i]['ID'] === viewingId) { idx = i; break; }
    }
    if (idx === -1) return;
    var next = idx + direction;
    if (next < 0 || next >= list.length) return;
    var nextId = list[next]['ID'];
    selectRow(nextId);
    openViewModal(nextId);
  }

  function closeViewModal() {
    document.getElementById('modal-view-overlay').classList.add('hidden');
    viewingId = null;
  }

  function switchViewToEdit() {
    if (!viewingId) return;
    var id = viewingId;
    closeViewModal();
    editRecord(id);
  }

  function deleteCurrentOrder() {
    if (!viewingId) return;
    if (authRol !== 'Admin') return;
    var id = viewingId;
    var r = recordsCache[id] || {};
    var info = [];
    if (r['N° Orden']) info.push('N° Orden: ' + r['N° Orden']);
    if (r['Cliente'])  info.push(r['Cliente']);
    if (r['Fecha Carga']) info.push(r['Fecha Carga']);
    showConfirm({
      title: 'Eliminar pedido',
      message: '¿Confirmás que querés eliminar este pedido? Esta acción no se puede deshacer.',
      items: info,
      requireWord: 'eliminar',
      okText: 'Eliminar',
      cancelText: 'Cancelar'
    }).then(function(ok) {
      if (!ok) return;
      var btn = document.getElementById('btn-view-delete');
      btn.disabled = true; btn.textContent = 'Eliminando...';
      google.script.run
        .withSuccessHandler(function() {
          btn.disabled = false; btn.textContent = 'Borrar';
          showToast('Pedido eliminado', 'success');
          closeViewModal();
          loadRecords();
        })
        .withFailureHandler(handleAuthError(function(err) {
          btn.disabled = false; btn.textContent = 'Borrar';
          showToast('Error: ' + (err ? err.message : 'desconocido'), 'error');
        }))
        .deleteOrder(authToken, id);
    });
  }

  document.getElementById('modal-view-overlay').addEventListener('mousedown', function(e) {
    if (e.target === this) closeViewModal();
  });

  document.addEventListener('keydown', function(e) {
    var overlay = document.getElementById('modal-view-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); navigateView(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigateView(1);  }
  });

  // ────────────────────────────────────────────
  // EDIT ORDER (Admin only)
  // ────────────────────────────────────────────
  function selectRow(id) {
    if (!id) return;
    selectedRowId = id;
    var tbody = document.getElementById('records-body');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach(function(tr) {
      if (tr.getAttribute('data-id') === id) tr.classList.add('row-selected');
      else                                   tr.classList.remove('row-selected');
    });
  }

  function editRecord(id) {
    var r = recordsCache[id];
    if (!r) return;
    editingId = id;
    document.getElementById('edit-record-id').textContent = 'ID: ' + id;
    document.getElementById('e-cliente').value    = r['Cliente']     || '';
    // Cargar la selección de cliente: si el pedido ya tiene Código Cliente y sigue siendo válido,
    // pre-llenar el badge; si no, queda vacío y el usuario debe re-seleccionar antes de guardar.
    clearClienteSelection('e-cliente');
    hideClienteSuggestions('e-cliente');
    var codPrev = String(r['Código Cliente'] || '').trim();
    if (codPrev) {
      var match = allClients.find(function(c) {
        return String(c.codigo || '').toLowerCase() === codPrev.toLowerCase();
      });
      if (match) {
        selectedEditClienteCodigo = match.codigo;
        var badge = document.getElementById('e-cliente-codigo-badge');
        if (badge) {
          badge.textContent = match.codigo;
          badge.className = 'cliente-badge';
          badge.style.display = 'inline-block';
        }
      }
    }
    document.getElementById('e-nroOrden').value   = r['N° Orden']    || '';
    document.getElementById('e-nroPedido').value  = stripAccents(r['N° Pedido'] || '');
    document.getElementById('e-entrega').value    = stripAccents(r['Entrega']   || '');
    document.getElementById('e-ciudad').value     = String(r['Ciudad']    || '').toUpperCase();
    document.getElementById('e-direccion').value  = stripAccents(r['Dirección'] || '').toUpperCase();
    document.getElementById('e-formaPago').value  = stripAccents(r['Forma Pago'] || '');
    document.getElementById('e-tipo').value       = r['Tipo']        || '';
    document.getElementById('e-marca').value      = normalizeMarca(r['Marca']     || '');
    document.getElementById('e-totalPares').value = r['Total Pares'] || '';
    document.getElementById('e-totalPrecio').value= r['Total Precio']|| '';
    document.getElementById('e-obs').value        = stripAccents(r['OBS'] || '');
    // Foto actual del pedido
    editingCurrentImgId = String(r['Imagen'] || '').trim();
    resetEditPhotoUI();
    var meo = document.getElementById('modal-edit-overlay');
    meo.classList.remove('hidden');
    focusFirstField(meo);
  }

  // Renderiza la sección de foto del modal de edición según el estado actual
  // (foto vigente vs nueva foto pendiente).
  function resetEditPhotoUI() {
    var thumb   = document.getElementById('e-photo-thumb');
    var empty   = document.getElementById('e-photo-empty');
    var wrap    = thumb.parentElement;
    var cancel  = document.getElementById('e-photo-cancel');
    var status  = document.getElementById('e-photo-status');
    var spinner = document.getElementById('e-photo-spinner');
    spinner.style.display = 'none';
    wrap.classList.remove('replaced');
    cancel.style.display = 'none';
    status.textContent = '';
    status.className = '';
    if (editingNewImageBase64) {
      thumb.src = 'data:' + editingNewImageMime + ';base64,' + editingNewImageBase64;
      thumb.style.display = '';
      empty.style.display = 'none';
      wrap.classList.add('replaced');
      cancel.style.display = '';
      status.textContent = 'Foto nueva lista — se guardará al confirmar';
      status.className = 'ok';
    } else if (editingCurrentImgId) {
      thumb.src = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(editingCurrentImgId) + '&sz=w400';
      thumb.style.display = '';
      empty.style.display = 'none';
    } else {
      thumb.src = '';
      thumb.style.display = 'none';
      empty.style.display = '';
    }
  }

  function handleEditPhotoSelect(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      showToast('El archivo supera los 20 MB', 'error');
      return;
    }
    var spinner = document.getElementById('e-photo-spinner');
    var status  = document.getElementById('e-photo-status');
    spinner.style.display = '';
    status.textContent = 'Procesando…';
    status.className = '';
    var reader = new FileReader();
    reader.onload = function(ev) {
      compressDataUrl(ev.target.result, { autoRotate: true }).then(function(out) {
        var commaIdx = out.dataUrl.indexOf(',');
        editingNewImageBase64 = out.dataUrl.substring(commaIdx + 1);
        editingNewImageMime   = out.mime || 'image/jpeg';
        resetEditPhotoUI();
      });
    };
    reader.onerror = function() {
      spinner.style.display = 'none';
      status.textContent = 'No se pudo leer el archivo';
      status.className = 'err';
    };
    reader.readAsDataURL(file);
  }

  function cancelEditPhotoChange() {
    editingNewImageBase64 = null;
    editingNewImageMime   = null;
    resetEditPhotoUI();
  }

  function closeEditModal() {
    document.getElementById('modal-edit-overlay').classList.add('hidden');
    editingId = null;
    editingNewImageBase64 = null;
    editingNewImageMime   = null;
    editingCurrentImgId   = null;
    clearClienteSelection('e-cliente');
    hideClienteSuggestions('e-cliente');
  }

  function saveEdit() {
    if (!editingId) return;
    var eCliente  = document.getElementById('e-cliente').value.trim();
    var eOrden    = document.getElementById('e-nroOrden').value.trim();
    var eTipo     = document.getElementById('e-tipo').value.trim();
    var eMarca    = document.getElementById('e-marca').value.trim();
    var ePares    = document.getElementById('e-totalPares').value.trim();
    var ePrecio   = document.getElementById('e-totalPrecio').value.trim();
    var missing  = [];
    var missingIds = [];
    if (!eCliente)  { missing.push('Cliente');      missingIds.push('e-cliente'); }
    if (!eOrden)    { missing.push('N° Orden');     missingIds.push('e-nroOrden'); }
    if (!eTipo)     { missing.push('Tipo');         missingIds.push('e-tipo'); }
    if (!eMarca)    { missing.push('Marca');        missingIds.push('e-marca'); }
    if (!ePares)    { missing.push('Total Pares');  missingIds.push('e-totalPares'); }
    if (!ePrecio)   { missing.push('Total Precio'); missingIds.push('e-totalPrecio'); }
    if (missing.length) {
      showToast('Campos obligatorios: ' + missing.join(', '), 'error');
      flashMissingFields(missingIds);
      return;
    }
    if (!selectedEditClienteCodigo) {
      showToast('Debe seleccionar un cliente del listado.', 'error');
      document.getElementById('e-cliente').focus();
      return;
    }
    if (!isValidAmount(eOrden)) {
      showToast('N° Orden debe ser un número. No se permiten letras ni símbolos.', 'error');
      document.getElementById('e-nroOrden').focus();
      return;
    }
    if (!isValidAmount(ePares)) {
      showToast('Total Pares debe ser un número. No se permiten letras ni símbolos.', 'error');
      document.getElementById('e-totalPares').focus();
      return;
    }
    ePares = formatAmount(parseAmount(ePares));
    if (!isValidAmount(ePrecio)) {
      showToast('Total Precio debe ser un número (ej: 9.661.600). No se permiten letras ni símbolos.', 'error');
      document.getElementById('e-totalPrecio').focus();
      return;
    }
    ePrecio = formatAmount(parseAmount(ePrecio));
    var btn = document.getElementById('btn-edit-save');
    btn.disabled = true; btn.textContent = 'Guardando...';

    var payload = {
      cliente:     eCliente,
      // El campo RUC ya no se captura en la UI, pero preservamos el valor existente del registro
      // (si lo hubiera) para no blanquearlo en pedidos viejos al editar.
      ruc:         (recordsCache[editingId] && recordsCache[editingId]['RUC']) || '',
      nroOrden:    eOrden,
      nroPedido:   stripAccents(document.getElementById('e-nroPedido').value.trim()),
      entrega:     stripAccents(document.getElementById('e-entrega').value.trim()),
      direccion:   stripAccents(document.getElementById('e-direccion').value.trim()),
      ciudad:      document.getElementById('e-ciudad').value.trim(),
      formaPago:   stripAccents(document.getElementById('e-formaPago').value.trim()),
      tipo:        eTipo,
      marca:       stripAccents(eMarca),
      totalPares:  ePares,
      totalPrecio: ePrecio,
      obs:         stripAccents(document.getElementById('e-obs').value.trim()),
      codigoCliente: selectedEditClienteCodigo || ''
    };

    function doUpdate() {
      google.script.run
        .withSuccessHandler(function() {
          btn.disabled = false; btn.textContent = 'Guardar cambios';
          showToast('Pedido actualizado', 'success');
          closeEditModal();
          loadRecords();
        })
        .withFailureHandler(handleAuthError(function(err) {
          btn.disabled = false; btn.textContent = 'Guardar cambios';
          showToast('Error: ' + (err ? err.message : ''), 'error');
        }))
        .updateOrder(authToken, editingId, payload);
    }

    if (editingNewImageBase64) {
      btn.textContent = 'Subiendo foto...';
      google.script.run
        .withSuccessHandler(function(res) {
          payload.imageFileId = res.fileId;
          btn.textContent = 'Guardando...';
          doUpdate();
        })
        .withFailureHandler(handleAuthError(function(err) {
          btn.disabled = false; btn.textContent = 'Guardar cambios';
          showToast('Error subiendo foto: ' + (err ? err.message : ''), 'error');
        }))
        .uploadImageOnly(authToken, editingNewImageBase64, editingNewImageMime, {
          nroOrden:      eOrden,
          codigoCliente: selectedEditClienteCodigo,
          cliente:       eCliente
        });
    } else {
      doUpdate();
    }
  }

  document.getElementById('modal-edit-overlay').addEventListener('mousedown', function(e) {
    if (e.target === this) closeEditModal();
  });

  // ────────────────────────────────────────────
  // REPORTES (Admin / AdminL)
  // ────────────────────────────────────────────
  var REP_PALETTE = ['#8A1B1A', '#c79b9a', '#d4a574', '#7b9e7e', '#6a8caf', '#a47ba3'];

  function loadReportes(forceRefresh) {
    // Si tenemos allRecords ya cargado, usamos ese cache. Si no, lo traemos.
    if (!forceRefresh && allRecords && allRecords.length) {
      renderReportes();
      return;
    }
    setTableLoading('panel-reportes', true);
    google.script.run
      .withSuccessHandler(function(rows) {
        setTableLoading('panel-reportes', false);
        allRecords = rows || [];
        recordsCache = {};
        allRecords.forEach(function(r) { if (r['ID']) recordsCache[r['ID']] = r; });
        renderReportes();
      })
      .withFailureHandler(handleAuthError(function(err) {
        setTableLoading('panel-reportes', false);
        document.getElementById('rep-evolution').innerHTML =
          '<div class="rep-empty">Error al cargar: ' + esc(err ? err.message : 'desconocido') + '</div>';
      }))
      .getOrders(authToken);
  }

  function ymd(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var dy = d.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (dy < 10 ? '0' + dy : dy);
  }

  // Devuelve { rows, fromDate, toDate, tipo } aplicando los filtros del panel.
  // Si el rango es inválido, devuelve null.
  function getReportFilteredData() {
    var fromInput = document.getElementById('rep-from');
    var toInput   = document.getElementById('rep-to');
    var tipoSel   = document.getElementById('rep-tipo');
    var today = new Date();
    if (!fromInput.value) fromInput.value = today.getFullYear() + '-01-01';
    if (!toInput.value)   toInput.value   = ymd(today);
    var fromDate = new Date(fromInput.value + 'T00:00:00');
    var toDate   = new Date(toInput.value   + 'T23:59:59');
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) return null;
    var tipo = tipoSel.value;
    var fromTs = fromDate.getTime();
    var toTs   = toDate.getTime();
    var rows = (allRecords || []).filter(function(r) {
      var ts = parseDateDMY(r['Fecha Carga']);
      if (!ts || ts < fromTs || ts > toTs) return false;
      if (tipo && String(r['Tipo'] || '').trim().toUpperCase() !== tipo) return false;
      return true;
    });
    return { rows: rows, fromDate: fromDate, toDate: toDate, tipo: tipo };
  }

  function renderReportes() {
    var f = getReportFilteredData();
    if (!f) {
      document.getElementById('rep-evolution').innerHTML =
        '<div class="rep-empty">Rango de fechas inválido</div>';
      return;
    }
    var rows = f.rows, fromDate = f.fromDate, toDate = f.toDate;

    // KPIs
    var totalCount = rows.length;
    var totalPares = 0, totalPrecio = 0;
    rows.forEach(function(r) {
      totalPares  += parseAmount(r['Total Pares']);
      totalPrecio += parseAmount(r['Total Precio']);
    });
    var avg = totalCount ? Math.round(totalPrecio / totalCount) : 0;
    document.getElementById('rep-kpi-count').textContent = totalCount;
    document.getElementById('rep-kpi-pares').textContent = formatAmount(totalPares);
    document.getElementById('rep-kpi-total').textContent = 'Gs. ' + formatAmount(totalPrecio);
    document.getElementById('rep-kpi-avg').textContent   = 'Gs. ' + formatAmount(avg);

    renderRepEvolution(rows, fromDate, toDate);
    renderRepTopBars('rep-top-clientes',   rows, 'Cliente', 10);
    renderRepTopBars('rep-top-marcas',     rows, 'Marca',   10, { uppercase: true });
    renderRepTopBars('rep-top-vendedores', rows, 'Usuario', 10, { uppercase: true });
    renderRepTopBars('rep-top-ciudades',   rows, 'Ciudad',  10, { uppercase: true });
    renderRepTopBars('rep-top-zonas',      rows, 'Zona',    10, { uppercase: true });
    renderRepDonut(rows, 'Usuario', '(sin vendedor)', 'vendedores');
  }

  function renderRepEvolution(rows, fromDate, toDate) {
    var MONTH_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    // Construir buckets mensuales entre fromDate y toDate (inclusive)
    var buckets = [];
    var y = fromDate.getFullYear(), m = fromDate.getMonth();
    var endY = toDate.getFullYear(), endM = toDate.getMonth();
    while (y < endY || (y === endY && m <= endM)) {
      buckets.push({ year: y, month: m, count: 0, amount: 0 });
      m++; if (m > 11) { m = 0; y++; }
    }
    if (!buckets.length) {
      document.getElementById('rep-evolution').innerHTML = '<div class="rep-empty">Sin rango válido</div>';
      return;
    }

    // Mostrar año en label sólo si el rango cubre más de un año calendario
    var multiYear = (fromDate.getFullYear() !== toDate.getFullYear());

    var keyOf = function(yr, mo) { return yr * 12 + mo; };
    var idxBy = {};
    buckets.forEach(function(b, i) { idxBy[keyOf(b.year, b.month)] = i; });

    rows.forEach(function(r) {
      var ts = parseDateDMY(r['Fecha Carga']);
      if (!ts) return;
      var d = new Date(ts);
      var k = keyOf(d.getFullYear(), d.getMonth());
      var i = idxBy[k];
      if (i == null) return;
      buckets[i].count += 1;
      buckets[i].amount += parseAmount(r['Total Precio']);
    });

    var maxAmount = Math.max.apply(null, buckets.map(function(b) { return b.amount; })) || 1;
    var maxCount  = Math.max.apply(null, buckets.map(function(b) { return b.count; }))  || 1;

    // SVG geometry: si los meses entran en el ancho disponible, el gráfico
    // ocupa exactamente ese ancho (sin scroll ni texto achicado). Si no
    // entran (rango largo en pantalla angosta), el viewBox crece para que
    // las barras no se aplasten y el contenedor scrollea horizontalmente.
    var N = buckets.length;
    var slotMin = 50;
    var container = document.getElementById('rep-evolution');
    var availW = (container && container.clientWidth) || 700;
    var neededW = 100 + slotMin * N;
    var W = Math.max(availW, neededW);
    var H = 240;
    var padL = 50, padR = 50, padT = 14, padB = 40;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;
    var slotW = innerW / N;
    var barW = Math.min(28, slotW * 0.55);

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" style="width:' + W + 'px" ' +
      'preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">';
    // Grilla
    for (var g = 0; g <= 3; g++) {
      var ly = padT + (innerH / 3) * g;
      svg += '<line class="rep-axis-line" x1="' + padL + '" y1="' + ly + '" x2="' + (W - padR) + '" y2="' + ly + '"/>';
      var valAmount = maxAmount * (1 - g / 3);
      svg += '<text class="rep-axis-label" x="' + (padL - 6) + '" y="' + (ly + 3) + '" text-anchor="end">' +
             formatRepMoney(valAmount) + '</text>';
      var valCount = Math.round(maxCount * (1 - g / 3));
      svg += '<text class="rep-axis-label" x="' + (W - padR + 6) + '" y="' + (ly + 3) + '" text-anchor="start">' +
             valCount + '</text>';
    }
    // Barras + línea de cantidad
    var pointsLine = [];
    for (var i = 0; i < N; i++) {
      var cx = padL + slotW * i + slotW / 2;
      var hAmount = (buckets[i].amount / maxAmount) * innerH;
      var yAmount = padT + innerH - hAmount;
      var label = MONTH_LABELS[buckets[i].month] + (multiYear ? "'" + String(buckets[i].year).slice(2) : '');
      svg += '<rect class="rep-bar-amount" x="' + (cx - barW / 2) + '" y="' + yAmount +
             '" width="' + barW + '" height="' + hAmount + '" rx="2">' +
             '<title>' + label + ' ' + buckets[i].year + '&#10;Monto: Gs ' + formatAmount(buckets[i].amount) +
             '&#10;Pedidos: ' + buckets[i].count + '</title></rect>';
      var yCount = padT + innerH - (buckets[i].count / maxCount) * innerH;
      pointsLine.push(cx + ',' + yCount);
      svg += '<text class="rep-axis-label" x="' + cx + '" y="' + (H - padB + 16) +
             '" text-anchor="middle">' + label + '</text>';
    }
    svg += '<polyline points="' + pointsLine.join(' ') + '" fill="none" stroke="#c79b9a" stroke-width="2" stroke-linejoin="round"/>';
    for (var j = 0; j < N; j++) {
      var parts = pointsLine[j].split(',');
      svg += '<circle cx="' + parts[0] + '" cy="' + parts[1] + '" r="3" fill="#c79b9a"/>';
    }
    svg += '</svg>';
    document.getElementById('rep-evolution').innerHTML = svg;
  }

  function renderRepTopBars(containerId, rows, key, topN, opts) {
    opts = opts || {};
    var groups = {};
    rows.forEach(function(r) {
      var name = String(r[key] || '').trim();
      if (!name) return;
      if (opts.uppercase) name = name.toUpperCase();
      if (!groups[name]) groups[name] = { count: 0, amount: 0, pares: 0 };
      groups[name].count  += 1;
      groups[name].amount += parseAmount(r['Total Precio']);
      groups[name].pares  += parseAmount(r['Total Pares']);
    });
    var arr = Object.keys(groups).map(function(name) {
      return { name: name, count: groups[name].count, amount: groups[name].amount, pares: groups[name].pares };
    }).sort(function(a, b) { return b.amount - a.amount; }).slice(0, topN);

    if (!arr.length) {
      document.getElementById(containerId).innerHTML = '<div class="rep-empty">Sin datos</div>';
      return;
    }
    var maxAmount = arr[0].amount || 1;
    document.getElementById(containerId).innerHTML = arr.map(function(g) {
      var pct = (g.amount / maxAmount) * 100;
      var displayName = g.name.length > 40 ? g.name.slice(0, 40) + '…' : g.name;
      return '<div class="rep-bar-row">' +
        '<div class="rep-bar-row-head">' +
          '<span class="rep-bar-name" title="' + esc(g.name) + '">' + esc(displayName) + '</span>' +
          '<span class="rep-bar-val">Gs ' + formatAmount(g.amount) + ' · ' + formatAmount(g.pares) + ' pares</span>' +
        '</div>' +
        '<div class="rep-bar-track"><div class="rep-bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '</div>';
    }).join('');
  }

  function renderRepDonut(rows, key, emptyLabel, unitLabel) {
    var groups = {};
    rows.forEach(function(r) {
      var name = (String(r[key] || '').trim() || emptyLabel).toUpperCase();
      if (!groups[name]) groups[name] = { count: 0, amount: 0 };
      groups[name].count  += 1;
      groups[name].amount += parseAmount(r['Total Precio']);
    });
    var arr = Object.keys(groups).map(function(name) {
      return { name: name, count: groups[name].count, amount: groups[name].amount };
    }).sort(function(a, b) { return b.amount - a.amount; });

    var total = arr.reduce(function(a, b) { return a + b.amount; }, 0);
    if (!total) {
      document.getElementById('rep-tipos').innerHTML = '<div class="rep-empty">Sin datos</div>';
      return;
    }

    // Donut SVG
    var size = 160, stroke = 24, r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
    var circ = 2 * Math.PI * r;
    var offset = 0;
    var segments = arr.map(function(s, i) {
      var pct = s.amount / total;
      var len = pct * circ;
      var pctTxt = (pct * 100).toFixed(1) + '%';
      var seg = '<circle class="rep-donut-seg" cx="' + cx + '" cy="' + cy + '" r="' + r +
                '" fill="none" stroke="' + REP_PALETTE[i % REP_PALETTE.length] +
                '" stroke-width="' + stroke +
                '" stroke-dasharray="' + len + ' ' + (circ - len) +
                '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')">' +
                '<title>' + esc(s.name) + '&#10;Gs ' + formatAmount(s.amount) +
                '&#10;' + s.count + ' pedidos · ' + pctTxt + '</title></circle>';
      offset += len;
      return seg;
    }).join('');
    var svg = '<svg class="rep-donut" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg">' +
              segments +
              '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="13" fill="#525252" font-weight="600">' +
              arr.length + ' ' + unitLabel + '</text>' +
              '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="10" fill="#737373">' +
              rows.length + ' pedidos</text>' +
              '</svg>';

    var legend = '<div class="rep-donut-legend">' + arr.map(function(s, i) {
      var pct = ((s.amount / total) * 100).toFixed(1);
      return '<div class="rep-donut-leg">' +
        '<span class="rep-donut-leg-dot" style="background:' + REP_PALETTE[i % REP_PALETTE.length] + '"></span>' +
        '<span class="rep-donut-leg-name">' + esc(s.name) + '</span>' +
        '<span class="rep-donut-leg-val">' + pct + '% · ' + s.count + '</span>' +
      '</div>';
    }).join('') + '</div>';

    document.getElementById('rep-tipos').innerHTML = svg + legend;
  }

  function formatRepMoney(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(Math.round(n));
  }

  // ────────────────────────────────────────────
  // PDF EXPORT — reproduce el reporte con listados COMPLETOS
  // ────────────────────────────────────────────
  function formatDateES(d) {
    var dd = d.getDate(), mm = d.getMonth() + 1, yy = d.getFullYear();
    return (dd < 10 ? '0' : '') + dd + '/' + (mm < 10 ? '0' : '') + mm + '/' + yy;
  }
  function formatDateTimeES(d) {
    var hh = d.getHours(), mi = d.getMinutes();
    return formatDateES(d) + ' ' + (hh < 10 ? '0' : '') + hh + ':' + (mi < 10 ? '0' : '') + mi;
  }
  function groupBy(rows, key, opts) {
    opts = opts || {};
    var groups = {};
    rows.forEach(function(r) {
      var name = String(r[key] || '').trim();
      if (!name) return;
      if (opts.uppercase) name = name.toUpperCase();
      if (!groups[name]) groups[name] = { count: 0, amount: 0, pares: 0 };
      groups[name].count  += 1;
      groups[name].amount += parseAmount(r['Total Precio']);
      groups[name].pares  += parseAmount(r['Total Pares']);
    });
    return Object.keys(groups).map(function(name) {
      return { name: name, count: groups[name].count, amount: groups[name].amount, pares: groups[name].pares };
    }).sort(function(a, b) { return b.amount - a.amount; });
  }

  // Para cada cliente, devuelve un mapa { clienteNombre: [{name: marca, count, amount}, ...] }
  function buildClientBrandBreakdown(rows) {
    return buildBrandBreakdownBy(rows, 'Cliente', false);
  }
  // Para cada vendedor (clave en MAYÚSCULAS como en la tabla), devuelve un mapa { vendedor: [{name: marca, count, amount}, ...] }
  function buildVendorBrandBreakdown(rows) {
    return buildBrandBreakdownBy(rows, 'Usuario', true);
  }
  // Para cada marca (MAYÚSCULAS), devuelve un mapa { marca: [{name: vendedor, count, amount}, ...] }
  function buildBrandVendorBreakdown(rows) {
    var byBrand = {};
    rows.forEach(function(r) {
      var marca = String(r['Marca'] || '').trim().toUpperCase();
      if (!marca) return;
      var vend = String(r['Usuario'] || '').trim().toUpperCase();
      if (!vend) vend = '(sin vendedor)';
      if (!byBrand[marca]) byBrand[marca] = {};
      if (!byBrand[marca][vend]) byBrand[marca][vend] = { count: 0, amount: 0, pares: 0 };
      byBrand[marca][vend].count  += 1;
      byBrand[marca][vend].amount += parseAmount(r['Total Precio']);
      byBrand[marca][vend].pares  += parseAmount(r['Total Pares']);
    });
    var out = {};
    Object.keys(byBrand).forEach(function(m) {
      out[m] = Object.keys(byBrand[m]).map(function(v) {
        return { name: v, count: byBrand[m][v].count, amount: byBrand[m][v].amount, pares: byBrand[m][v].pares };
      }).sort(function(a, b) { return b.amount - a.amount; });
    });
    return out;
  }
  function buildBrandBreakdownBy(rows, parentKey, uppercaseParent) {
    var byParent = {};
    rows.forEach(function(r) {
      var parent = String(r[parentKey] || '').trim();
      if (!parent) return;
      if (uppercaseParent) parent = parent.toUpperCase();
      var marca = String(r['Marca'] || '').trim().toUpperCase();
      if (!marca) marca = '(sin marca)';
      if (!byParent[parent]) byParent[parent] = {};
      if (!byParent[parent][marca]) byParent[parent][marca] = { count: 0, amount: 0, pares: 0 };
      byParent[parent][marca].count  += 1;
      byParent[parent][marca].amount += parseAmount(r['Total Precio']);
      byParent[parent][marca].pares  += parseAmount(r['Total Pares']);
    });
    var out = {};
    Object.keys(byParent).forEach(function(p) {
      out[p] = Object.keys(byParent[p]).map(function(m) {
        return { name: m, count: byParent[p][m].count, amount: byParent[p][m].amount, pares: byParent[p][m].pares };
      }).sort(function(a, b) { return b.amount - a.amount; });
    });
    return out;
  }

  function openRepExportDrawer() {
    document.getElementById('rep-export-drawer').classList.add('open');
    document.getElementById('rep-export-drawer-overlay').classList.add('open');
  }
  function closeRepExportDrawer() {
    document.getElementById('rep-export-drawer').classList.remove('open');
    document.getElementById('rep-export-drawer-overlay').classList.remove('open');
  }
  function repDrawerSelectAll() {
    ['rep-sec-clientes', 'rep-sec-vendedores', 'rep-sec-marcas', 'rep-sec-ciudades', 'rep-sec-zonas'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.checked = true;
    });
  }
  function getRepSelectedSections() {
    return {
      clientes:   !!(document.getElementById('rep-sec-clientes')   || {}).checked,
      vendedores: !!(document.getElementById('rep-sec-vendedores') || {}).checked,
      marcas:     !!(document.getElementById('rep-sec-marcas')     || {}).checked,
      ciudades:   !!(document.getElementById('rep-sec-ciudades')   || {}).checked,
      zonas:      !!(document.getElementById('rep-sec-zonas')      || {}).checked
    };
  }

  function exportReportPDF() {
    var f = getReportFilteredData();
    if (!f) { showToast('Rango de fechas inválido', 'error'); return; }
    var rows = f.rows, fromDate = f.fromDate, toDate = f.toDate, tipo = f.tipo;
    var includeBreakdown = !!(document.getElementById('rep-include-breakdown') || {}).checked;
    var sections = getRepSelectedSections();
    if (!sections.clientes && !sections.vendedores && !sections.marcas && !sections.ciudades && !sections.zonas) {
      showToast('Elegí al menos una sección para exportar', 'error');
      return;
    }

    // KPIs
    var totalCount = rows.length;
    var totalPares = 0, totalPrecio = 0;
    rows.forEach(function(r) {
      totalPares  += parseAmount(r['Total Pares']);
      totalPrecio += parseAmount(r['Total Precio']);
    });
    var avg = totalCount ? Math.round(totalPrecio / totalCount) : 0;

    // Listas completas (solo lo que se necesita según secciones elegidas)
    var clientes   = sections.clientes   ? groupBy(rows, 'Cliente')             : [];
    var marcas     = sections.marcas     ? groupBy(rows, 'Marca',   { uppercase: true }) : [];
    var vendedores = sections.vendedores ? groupBy(rows, 'Usuario', { uppercase: true }) : [];
    var ciudades   = sections.ciudades   ? groupBy(rows, 'Ciudad',  { uppercase: true }) : [];
    var zonas      = sections.zonas      ? groupBy(rows, 'Zona',    { uppercase: true }) : [];
    var clientBrandMap = (sections.clientes   && includeBreakdown) ? buildClientBrandBreakdown(rows) : null;
    var vendorBrandMap = (sections.vendedores && includeBreakdown) ? buildVendorBrandBreakdown(rows) : null;
    var brandVendorMap = (sections.marcas     && includeBreakdown) ? buildBrandVendorBreakdown(rows) : null;
    var ciudadBrandMap = (sections.ciudades   && includeBreakdown) ? buildBrandBreakdownBy(rows, 'Ciudad', true) : null;
    var zonaBrandMap   = (sections.zonas      && includeBreakdown) ? buildBrandBreakdownBy(rows, 'Zona',   true) : null;

    // Encabezado
    var headerHtml =
      '<div class="pdf-header">' +
        '<div class="pdf-title">LA COSTA S.R.L · Reporte</div>' +
        '<div class="pdf-meta">' +
          '<b>Período:</b> ' + formatDateES(fromDate) + ' al ' + formatDateES(toDate) +
          (tipo ? ' &nbsp;·&nbsp; <b>Tipo:</b> ' + esc(tipo) : '') +
          '<br>' +
          '<b>Generado por:</b> ' + esc(authUsername || '') +
          ' &nbsp;·&nbsp; ' + formatDateTimeES(new Date()) +
        '</div>' +
      '</div>';

    // KPIs
    var kpisHtml =
      '<div class="pdf-kpis">' +
        '<div class="pdf-kpi"><div class="pdf-kpi-label">Pedidos</div>'    + '<div class="pdf-kpi-value">' + totalCount + '</div></div>' +
        '<div class="pdf-kpi"><div class="pdf-kpi-label">Total Pares</div>'+ '<div class="pdf-kpi-value">' + formatAmount(totalPares) + '</div></div>' +
        '<div class="pdf-kpi"><div class="pdf-kpi-label">Suma Total</div>' + '<div class="pdf-kpi-value">Gs ' + formatAmount(totalPrecio) + '</div></div>' +
        '<div class="pdf-kpi"><div class="pdf-kpi-label">Ticket prom.</div>' + '<div class="pdf-kpi-value">Gs ' + formatAmount(avg) + '</div></div>' +
      '</div>';

    // Secciones (solo las elegidas en el panel de exportación)
    var html = headerHtml + kpisHtml;
    if (sections.clientes) {
      html += '<div class="pdf-section"><div class="pdf-section-title">Clientes (' + clientes.length + ')</div>' +
        buildPdfListTable(clientes, totalPrecio, 'Cliente', clientBrandMap) + '</div>';
    }
    if (sections.vendedores) {
      html += '<div class="pdf-section"><div class="pdf-section-title">Vendedores (' + vendedores.length + ')</div>' +
        buildPdfListTable(vendedores, totalPrecio, 'Vendedor', vendorBrandMap) + '</div>';
    }
    if (sections.marcas) {
      html += '<div class="pdf-section"><div class="pdf-section-title">Marcas (' + marcas.length + ')</div>' +
        buildPdfListTable(marcas, totalPrecio, 'Marca', brandVendorMap) + '</div>';
    }
    if (sections.ciudades) {
      html += '<div class="pdf-section"><div class="pdf-section-title">Ciudades (' + ciudades.length + ')</div>' +
        buildPdfListTable(ciudades, totalPrecio, 'Ciudad', ciudadBrandMap) + '</div>';
    }
    if (sections.zonas) {
      html += '<div class="pdf-section"><div class="pdf-section-title">Zonas (' + zonas.length + ')</div>' +
        buildPdfListTable(zonas, totalPrecio, 'Zona', zonaBrandMap) + '</div>';
    }

    var printArea = document.getElementById('print-area');
    printArea.innerHTML = html;

    // Disparar impresión y limpiar después
    function onAfterPrint() {
      printArea.innerHTML = '';
      window.removeEventListener('afterprint', onAfterPrint);
    }
    window.addEventListener('afterprint', onAfterPrint);
    setTimeout(function() { window.print(); }, 50);
  }

  function buildPdfListTable(items, totalAmount, nameHeader, childrenMap) {
    if (!items.length) return '<div style="font-size:9pt;color:#888;padding:6px 0">Sin datos</div>';
    var html = '<table class="pdf-table"><thead><tr>' +
      '<th style="width:24px">#</th>' +
      '<th>' + esc(nameHeader) + '</th>' +
      '<th class="num" style="width:70px">Pedidos</th>' +
      '<th class="num" style="width:70px">Pares</th>' +
      '<th class="num" style="width:110px">Monto (Gs)</th>' +
      '<th class="num" style="width:55px">%</th>' +
    '</tr></thead><tbody>';
    items.forEach(function(it, i) {
      var pct = totalAmount ? ((it.amount / totalAmount) * 100).toFixed(1) : '0.0';
      html += '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(it.name) + '</td>' +
        '<td class="num">' + it.count + '</td>' +
        '<td class="num">' + formatAmount(it.pares || 0) + '</td>' +
        '<td class="num">' + formatAmount(it.amount) + '</td>' +
        '<td class="num">' + pct + '%</td>' +
      '</tr>';
      if (childrenMap && childrenMap[it.name]) {
        var kids = childrenMap[it.name];
        kids.forEach(function(k) {
          var kPct = it.amount ? ((k.amount / it.amount) * 100).toFixed(1) : '0.0';
          html += '<tr class="pdf-child-row">' +
            '<td></td>' +
            '<td style="padding-left:18px;color:#555">↳ ' + esc(k.name) + '</td>' +
            '<td class="num" style="color:#555">' + k.count + '</td>' +
            '<td class="num" style="color:#555">' + formatAmount(k.pares || 0) + '</td>' +
            '<td class="num" style="color:#555">' + formatAmount(k.amount) + '</td>' +
            '<td class="num" style="color:#555">' + kPct + '%</td>' +
          '</tr>';
        });
      }
    });
    html += '</tbody></table>';
    return html;
  }

  // Exporta el reporte (clientes, marcas, vendedores) a un único CSV con secciones.
  function exportReportCSV() {
    var f = getReportFilteredData();
    if (!f) { showToast('Rango de fechas inválido', 'error'); return; }
    var rows = f.rows, fromDate = f.fromDate, toDate = f.toDate, tipo = f.tipo;
    var includeBreakdown = !!(document.getElementById('rep-include-breakdown') || {}).checked;
    var sections = getRepSelectedSections();
    if (!sections.clientes && !sections.vendedores && !sections.marcas && !sections.ciudades && !sections.zonas) {
      showToast('Elegí al menos una sección para exportar', 'error');
      return;
    }

    var totalPrecio = 0;
    rows.forEach(function(r) { totalPrecio += parseAmount(r['Total Precio']); });
    var clientes   = sections.clientes   ? groupBy(rows, 'Cliente')             : [];
    var marcas     = sections.marcas     ? groupBy(rows, 'Marca',   { uppercase: true }) : [];
    var vendedores = sections.vendedores ? groupBy(rows, 'Usuario', { uppercase: true }) : [];
    var ciudades   = sections.ciudades   ? groupBy(rows, 'Ciudad',  { uppercase: true }) : [];
    var zonas      = sections.zonas      ? groupBy(rows, 'Zona',    { uppercase: true }) : [];
    var clientBrandMap = (sections.clientes   && includeBreakdown) ? buildClientBrandBreakdown(rows) : null;
    var vendorBrandMap = (sections.vendedores && includeBreakdown) ? buildVendorBrandBreakdown(rows) : null;
    var brandVendorMap = (sections.marcas     && includeBreakdown) ? buildBrandVendorBreakdown(rows) : null;
    var ciudadBrandMap = (sections.ciudades   && includeBreakdown) ? buildBrandBreakdownBy(rows, 'Ciudad', true) : null;
    var zonaBrandMap   = (sections.zonas      && includeBreakdown) ? buildBrandBreakdownBy(rows, 'Zona',   true) : null;

    function csvCell(v) {
      var s = (v === null || v === undefined) ? '' : String(v);
      if (/[",;\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    function sectionLines(title, items, nameHeader, childrenMap) {
      var out = [];
      out.push(csvCell(title + ' (' + items.length + ')'));
      out.push(['#', nameHeader, 'Pedidos', 'Pares', 'Monto (Gs)', '%'].map(csvCell).join(';'));
      items.forEach(function(it, i) {
        var pct = totalPrecio ? ((it.amount / totalPrecio) * 100).toFixed(1) : '0.0';
        out.push([(i + 1), it.name, it.count, formatAmount(it.pares || 0), formatAmount(it.amount), pct + '%'].map(csvCell).join(';'));
        if (childrenMap && childrenMap[it.name]) {
          childrenMap[it.name].forEach(function(k) {
            var kPct = it.amount ? ((k.amount / it.amount) * 100).toFixed(1) : '0.0';
            out.push(['', '   ↳ ' + k.name, k.count, formatAmount(k.pares || 0), formatAmount(k.amount), kPct + '%'].map(csvCell).join(';'));
          });
        }
      });
      if (!items.length) out.push(csvCell('Sin datos'));
      return out;
    }

    var lines = [];
    // Metadatos arriba del CSV (sirve para saber a qué corresponde el archivo al abrirlo)
    lines.push(csvCell('LA COSTA S.R.L - Reporte'));
    lines.push(csvCell('Período: ' + formatDateES(fromDate) + ' al ' + formatDateES(toDate)));
    if (tipo) lines.push(csvCell('Tipo: ' + tipo));
    lines.push(csvCell('Generado por: ' + (authUsername || '') + ' - ' + formatDateTimeES(new Date())));
    if (sections.clientes)   { lines.push(''); lines = lines.concat(sectionLines('Clientes',   clientes,   'Cliente', clientBrandMap)); }
    if (sections.vendedores) { lines.push(''); lines = lines.concat(sectionLines('Vendedores', vendedores, 'Vendedor', vendorBrandMap)); }
    if (sections.marcas)     { lines.push(''); lines = lines.concat(sectionLines('Marcas',     marcas,     'Marca', brandVendorMap)); }
    if (sections.ciudades)   { lines.push(''); lines = lines.concat(sectionLines('Ciudades',   ciudades,   'Ciudad', ciudadBrandMap)); }
    if (sections.zonas)      { lines.push(''); lines = lines.concat(sectionLines('Zonas',      zonas,      'Zona', zonaBrandMap)); }

    var csv = '﻿' + lines.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var ts = new Date();
    var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    var fname = 'reporte_' + ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) +
                '_' + pad(ts.getHours()) + pad(ts.getMinutes()) + '.csv';
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    showToast('Reporte exportado', 'success');
  }

  // ────────────────────────────────────────────
  // USERS MANAGEMENT (Admin only)
  // ────────────────────────────────────────────
  function loadUsers() {
    setTableLoading('panel-usuarios', true);
    google.script.run
      .withSuccessHandler(function(users) {
        setTableLoading('panel-usuarios', false);
        renderUsers(users || []);
      })
      .withFailureHandler(handleAuthError(function(err) {
        setTableLoading('panel-usuarios', false);
        document.getElementById('users-body').innerHTML =
          '<tr><td colspan="5" class="empty-table">Error: ' + (err ? err.message : '') + '</td></tr>';
      }))
      .listUsers(authToken);
  }

  function renderUsers(users) {
    usersCache = {};
    users.forEach(function(u) { usersCache[u.id] = u; });
    var tbody = document.getElementById('users-body');
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-table">No hay usuarios registrados</td></tr>';
      return;
    }
    tbody.innerHTML = users.map(function(u) {
      var rolBadge = u.rol === 'Admin'
        ? '<span class="badge-admin">Admin</span>'
        : (u.rol === 'AdminL'
            ? '<span class="badge-adminl">AdminL</span>'
            : '<span class="badge-user">User</span>');
      var status = u.activo === 'true'
        ? '<span class="status-active">● Activo</span>'
        : '<span class="status-inactive">● Inactivo</span>';
      var isSelf = u.username === authUsername;
      var rid = esc(u.id);
      return '<tr data-id="' + rid + '" tabindex="0" role="button" aria-label="Ver usuario" ' +
        'onclick="openUserViewModal(\'' + rid + '\')" ' +
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openUserViewModal(\'' + rid + '\');}">' +
        '<td style="font-weight:600"><span class="username-display">' + esc(u.username) + '</span>' + (isSelf ? ' <span style="font-size:0.7rem;color:var(--gray-400)">(vos)</span>' : '') + '</td>' +
        '<td>' + rolBadge + '</td>' +
        '<td>' + esc(u.fechaCreacion) + '</td>' +
        '<td>' + status + '</td>' +
      '</tr>';
    }).join('');
  }

  // ── Modal Ver Usuario ──
  function openUserViewModal(id) {
    var u = usersCache[id];
    if (!u) return;
    viewingUserId = id;
    var canManage = authRol === 'Admin';
    var isSelf = u.username === authUsername;
    document.getElementById('uv-record-id').textContent = 'ID: ' + id;
    document.getElementById('uv-username').textContent = u.username;
    document.getElementById('uv-rol').textContent = u.rol === 'Admin' ? 'Admin' : (u.rol === 'AdminL' ? 'AdminL' : 'User');
    document.getElementById('uv-estado').textContent = u.activo === 'true' ? 'Activo' : 'Inactivo';
    document.getElementById('uv-fecha').textContent = u.fechaCreacion || '';
    var foto = document.getElementById('uv-foto');
    foto.innerHTML = u.fotoUrl ? '<img src="' + esc(u.fotoUrl) + '" alt="">' : esc((u.username || '?').charAt(0).toUpperCase());
    document.getElementById('btn-uv-edit').style.display = canManage ? '' : 'none';
    document.getElementById('btn-uv-delete').style.display = (canManage && !isSelf) ? '' : 'none';
    document.getElementById('modal-view-user-overlay').classList.remove('hidden');
  }

  function closeUserViewModal() {
    document.getElementById('modal-view-user-overlay').classList.add('hidden');
    viewingUserId = null;
  }

  function switchUserViewToEdit() {
    if (!viewingUserId) return;
    var id = viewingUserId;
    closeUserViewModal();
    openEditUserModal(id);
  }

  function deleteCurrentUser() {
    if (!viewingUserId) return;
    var u = usersCache[viewingUserId];
    if (!u) return;
    confirmDeleteUser(viewingUserId, u.username);
  }

  document.getElementById('modal-view-user-overlay').addEventListener('mousedown', function(e) {
    if (e.target === this) closeUserViewModal();
  });

  function resetUserFotoPicker(initial, existingUrl) {
    pendingUserFoto = null;
    removeUserFotoFlag = false;
    document.getElementById('u-foto-input').value = '';
    var preview = document.getElementById('u-foto-preview');
    var removeBtn = document.getElementById('u-foto-remove');
    if (existingUrl) {
      preview.innerHTML = '<img src="' + esc(existingUrl) + '" alt="">';
      removeBtn.style.display = '';
    } else {
      preview.textContent = (initial || '?').toUpperCase();
      removeBtn.style.display = 'none';
    }
  }

  function onUserFotoSelected(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      compressAvatarDataUrl(e.target.result).then(function(c) {
        pendingUserFoto = c;
        removeUserFotoFlag = false;
        document.getElementById('u-foto-preview').innerHTML = '<img src="' + c.dataUrl + '" alt="">';
        document.getElementById('u-foto-remove').style.display = '';
      });
    };
    reader.readAsDataURL(file);
  }

  function removeUserFoto() {
    pendingUserFoto = null;
    removeUserFotoFlag = true;
    var username = document.getElementById('u-username').value.trim();
    document.getElementById('u-foto-preview').textContent = (username || '?').charAt(0).toUpperCase();
    document.getElementById('u-foto-remove').style.display = 'none';
    document.getElementById('u-foto-input').value = '';
  }

  function openNewUserModal() {
    editingUserId = null;
    document.getElementById('user-modal-title').textContent = 'Nuevo Usuario';
    document.getElementById('u-username').value = '';
    document.getElementById('u-password').value = '';
    document.getElementById('u-rol').value = 'User';
    document.getElementById('u-password-label').textContent = 'Contraseña';
    document.getElementById('u-activo-group').style.display = 'none';
    resetUserFotoPicker('?', '');
    document.getElementById('modal-user-overlay').classList.remove('hidden');
    setTimeout(function() { document.getElementById('u-username').focus(); }, 80);
  }

  function openEditUserModal(id) {
    var u = usersCache[id];
    if (!u) return;
    editingUserId = id;
    document.getElementById('user-modal-title').textContent = 'Editar Usuario';
    document.getElementById('u-username').value = u.username;
    document.getElementById('u-password').value = '';
    document.getElementById('u-password-label').textContent = 'Nueva contraseña (dejar vacío para no cambiar)';
    document.getElementById('u-rol').value = u.rol;
    document.getElementById('u-activo').value = u.activo;
    document.getElementById('u-activo-group').style.display = 'block';
    resetUserFotoPicker(u.username, u.fotoUrl);
    var muo = document.getElementById('modal-user-overlay');
    muo.classList.remove('hidden');
    focusFirstField(muo);
  }

  function closeUserModal() {
    document.getElementById('modal-user-overlay').classList.add('hidden');
    editingUserId = null;
    pendingUserFoto = null;
    removeUserFotoFlag = false;
  }

  function saveUser() {
    var username = document.getElementById('u-username').value.trim();
    var password = document.getElementById('u-password').value;
    var rol      = document.getElementById('u-rol').value;
    var activo   = document.getElementById('u-activo').value;
    var btn = document.getElementById('btn-user-save');
    btn.disabled = true; btn.textContent = 'Guardando...';

    if (editingUserId) {
      var userData = { username: username, rol: rol, activo: activo };
      if (password) userData.password = password;
      if (pendingUserFoto) { userData.fotoBase64 = pendingUserFoto.dataUrl.split(',')[1]; userData.fotoMime = pendingUserFoto.mime; }
      else if (removeUserFotoFlag) { userData.removeFoto = true; }
      google.script.run
        .withSuccessHandler(function() {
          btn.disabled = false; btn.textContent = 'Guardar';
          closeUserModal();
          loadUsers();
          showToast('Usuario actualizado', 'success');
        })
        .withFailureHandler(handleAuthError(function(err) {
          btn.disabled = false; btn.textContent = 'Guardar';
          showToast('Error: ' + (err ? err.message : ''), 'error');
        }))
        .updateUser(authToken, editingUserId, userData);
    } else {
      var newUserData = { username: username, password: password, rol: rol };
      if (pendingUserFoto) { newUserData.fotoBase64 = pendingUserFoto.dataUrl.split(',')[1]; newUserData.fotoMime = pendingUserFoto.mime; }
      google.script.run
        .withSuccessHandler(function() {
          btn.disabled = false; btn.textContent = 'Guardar';
          closeUserModal();
          loadUsers();
          showToast('Usuario creado', 'success');
        })
        .withFailureHandler(handleAuthError(function(err) {
          btn.disabled = false; btn.textContent = 'Guardar';
          showToast('Error: ' + (err ? err.message : ''), 'error');
        }))
        .createUser(authToken, newUserData);
    }
  }

  function confirmDeleteUser(id, username) {
    if (!confirm('¿Eliminar al usuario "' + username + '"?\nEsta acción no se puede deshacer.')) return;
    google.script.run
      .withSuccessHandler(function() {
        closeUserViewModal();
        loadUsers();
        showToast('Usuario eliminado', 'success');
      })
      .withFailureHandler(handleAuthError(function(err) {
        showToast('Error: ' + (err ? err.message : ''), 'error');
      }))
      .deleteUser(authToken, id);
  }

  document.getElementById('modal-user-overlay').addEventListener('mousedown', function(e) {
    if (e.target === this) closeUserModal();
  });

  // ────────────────────────────────────────────
  // CLIENTES — AUTOCOMPLETE (genérico, sirve para Nuevo Pedido y Editar)
  // ────────────────────────────────────────────
  // Contexto por input id: { badgeId, suggestionsId, getCodigo, setCodigo, filtered, activeIdx }
  var clienteACContexts = {
    'f-cliente': {
      badgeId: 'cliente-codigo-badge',
      suggestionsId: 'cliente-suggestions',
      ciudadFieldId: 'f-ciudad',
      getCodigo: function() { return selectedClienteCodigo; },
      setCodigo: function(v) { selectedClienteCodigo = v; },
      filtered: [], activeIdx: -1
    },
    'e-cliente': {
      badgeId: 'e-cliente-codigo-badge',
      suggestionsId: 'e-cliente-suggestions',
      ciudadFieldId: 'e-ciudad',
      getCodigo: function() { return selectedEditClienteCodigo; },
      setCodigo: function(v) { selectedEditClienteCodigo = v; },
      filtered: [], activeIdx: -1
    },
    'if-cliente': {
      badgeId: 'if-cliente-codigo-badge',
      suggestionsId: 'if-cliente-suggestions',
      ciudadFieldId: 'if-ciudad',
      getCodigo: function() { return selectedInformeClienteCodigo; },
      setCodigo: function(v) { selectedInformeClienteCodigo = v; },
      onSelect: function() { updateInformeSaveButtonState(); },
      filtered: [], activeIdx: -1
    },
    'ie-cliente': {
      badgeId: 'ie-cliente-codigo-badge',
      suggestionsId: 'ie-cliente-suggestions',
      ciudadFieldId: null,
      getCodigo: function() { return selectedEditInformeClienteCodigo; },
      setCodigo: function(v) { selectedEditInformeClienteCodigo = v; },
      filtered: [], activeIdx: -1
    }
  };

  function filterClients(query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return allClients.filter(function(c) {
      return String(c.codigo || '').toLowerCase().indexOf(q) !== -1
          || String(c.razonSocial || '').toLowerCase().indexOf(q) !== -1
          || String(c.nombreFantasia || '').toLowerCase().indexOf(q) !== -1;
    }).slice(0, 10);
  }

  function renderClienteSuggestions(inputId) {
    var ctx = clienteACContexts[inputId]; if (!ctx) return;
    var box = document.getElementById(ctx.suggestionsId);
    if (!box) return;
    var list = ctx.filtered;
    if (!list.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.innerHTML = list.map(function(c, idx) {
      return '<div class="autocomplete-item' + (idx === ctx.activeIdx ? ' active' : '') + '" data-idx="' + idx + '">' +
        '<span class="ac-codigo">' + esc(c.codigo) + '</span>' +
        '<span class="ac-razon">' + esc(c.razonSocial) + '</span>' +
        (c.nombreFantasia ? '<span class="ac-fant">' + esc(c.nombreFantasia) + '</span>' : '') +
      '</div>';
    }).join('');
    box.style.display = 'block';
    Array.prototype.forEach.call(box.querySelectorAll('.autocomplete-item'), function(el) {
      el.addEventListener('mousedown', function(e) {
        e.preventDefault(); // evita blur antes del click
        var idx = parseInt(el.getAttribute('data-idx'), 10);
        selectCliente(inputId, ctx.filtered[idx]);
      });
    });
  }

  function hideClienteSuggestions(inputId) {
    var ctx = clienteACContexts[inputId]; if (!ctx) return;
    var box = document.getElementById(ctx.suggestionsId);
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    ctx.activeIdx = -1;
    ctx.filtered = [];
  }

  function selectCliente(inputId, c) {
    if (!c) return;
    var ctx = clienteACContexts[inputId]; if (!ctx) return;
    var input = document.getElementById(inputId);
    input.value = c.razonSocial;
    input.classList.add('filled');
    ctx.setCodigo(c.codigo);
    var badge = document.getElementById(ctx.badgeId);
    if (badge) {
      badge.textContent = c.codigo;
      badge.className = 'cliente-badge';
      badge.style.display = 'inline-block';
    }
    if (ctx.ciudadFieldId) {
      var ciudadEl = document.getElementById(ctx.ciudadFieldId);
      if (ciudadEl) {
        ciudadEl.value = c.ciudad || '';
        ciudadEl.classList.toggle('filled', !!c.ciudad);
      }
    }
    hideClienteSuggestions(inputId);
    if (typeof ctx.onSelect === 'function') ctx.onSelect(c);
  }

  // Borra la selección actual sin tocar el texto del input (usado al recargar / al editar manualmente).
  function clearClienteSelection(inputId) {
    var ctx = clienteACContexts[inputId]; if (!ctx) return;
    if (ctx.getCodigo()) ctx.setCodigo('');
    var badge = document.getElementById(ctx.badgeId);
    if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
    if (ctx.ciudadFieldId) {
      var ciudadEl = document.getElementById(ctx.ciudadFieldId);
      if (ciudadEl) { ciudadEl.value = ''; ciudadEl.classList.remove('filled'); }
    }
    if (typeof ctx.onSelect === 'function') ctx.onSelect(null);
  }

  function onClienteInput(e) {
    var inputId = e.target.id;
    var ctx = clienteACContexts[inputId]; if (!ctx) return;
    // Cualquier edición manual invalida la selección previa
    if (ctx.getCodigo()) clearClienteSelection(inputId);
    ctx.filtered = filterClients(e.target.value);
    ctx.activeIdx = -1;
    renderClienteSuggestions(inputId);
  }

  function onClienteFocus(e) {
    var inputId = e.target.id;
    var ctx = clienteACContexts[inputId]; if (!ctx) return;
    if (!e.target.value) return;
    // Si ya hay un cliente válido seleccionado, no molestar abriendo el dropdown al recibir foco.
    if (ctx.getCodigo()) return;
    ctx.filtered = filterClients(e.target.value);
    renderClienteSuggestions(inputId);
  }

  function onClienteBlur(e) {
    var inputId = e.target.id;
    // Pequeño delay para permitir que un click en una sugerencia se procese
    setTimeout(function(){ hideClienteSuggestions(inputId); }, 150);
  }

  function onClienteKey(e) {
    var inputId = e.target.id;
    var ctx = clienteACContexts[inputId]; if (!ctx) return;
    var box = document.getElementById(ctx.suggestionsId);
    var isOpen = box && box.style.display === 'block' && ctx.filtered.length;
    if (e.key === 'ArrowDown' && isOpen) {
      e.preventDefault();
      ctx.activeIdx = (ctx.activeIdx + 1) % ctx.filtered.length;
      renderClienteSuggestions(inputId);
    } else if (e.key === 'ArrowUp' && isOpen) {
      e.preventDefault();
      ctx.activeIdx = (ctx.activeIdx <= 0 ? ctx.filtered.length : ctx.activeIdx) - 1;
      renderClienteSuggestions(inputId);
    } else if (e.key === 'Enter' && isOpen && ctx.activeIdx >= 0) {
      e.preventDefault();
      selectCliente(inputId, ctx.filtered[ctx.activeIdx]);
    } else if (e.key === 'Escape') {
      hideClienteSuggestions(inputId);
    }
  }

  // Bind autocomplete listeners a un input específico
  function bindClienteAutocomplete(inputId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('input', onClienteInput);
    input.addEventListener('focus', onClienteFocus);
    input.addEventListener('blur',  onClienteBlur);
    input.addEventListener('keydown', onClienteKey);
  }

  (function() {
    bindClienteAutocomplete('f-cliente');
    bindClienteAutocomplete('e-cliente');
    bindClienteAutocomplete('if-cliente');
    bindClienteAutocomplete('ie-cliente');
  })();

  // ────────────────────────────────────────────
  // INFORMES — Visitas de vendedores
  // ────────────────────────────────────────────

  // Cambia entre las 3 sub-pestañas de Informes (Nuevo informe / Informes / Mapa)
  function switchInformeTab(name, focusId) {
    informesCurrentTab = name;
    if (name === 'mapa') pendingInformeMapFocusId = focusId || null;
    ['nuevo-informe', 'informes', 'mapa'].forEach(function(t) {
      var tb = document.getElementById('tab-' + t);
      var pb = document.getElementById('panel-' + t);
      if (tb) tb.classList.toggle('active', t === name);
      if (pb) pb.classList.toggle('active', t === name);
    });
    relocateInformeFiltersWrap(name);
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    if (name === 'nuevo-informe') {
      // Siempre vuelve a pedir la ubicación al entrar a esta pestaña (no reusa
      // una capturada antes): si el vendedor ya cargó un informe y se movió a
      // otro cliente, la posición vieja quedaría desactualizada.
      captureInformeLocation();
    } else if (name === 'informes') {
      loadInformes();
    } else if (name === 'mapa') {
      if (!allInformes.length) loadInformes(); // primera vez que se entra a Informes en esta sesión
      setTimeout(renderInformesMap, 0); // el contenedor recién queda visible ahora
    }
  }

  // ── Geolocalización (obligatoria para guardar) ──
  function captureInformeLocation() {
    var box    = document.getElementById('if-location-box');
    var status = document.getElementById('if-location-status');
    var coords = document.getElementById('if-location-coords');
    var btn    = document.getElementById('if-btn-location');
    currentInformeLat = null;
    currentInformeLng = null;
    box.className = 'location-box';
    status.textContent = 'Obteniendo ubicación...';
    coords.textContent = '';
    btn.textContent = 'Reintentar';
    updateInformeSaveButtonState();

    if (!('geolocation' in navigator)) {
      box.className = 'location-box err';
      status.textContent = 'Este dispositivo/navegador no soporta ubicación. No se puede guardar el informe.';
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        currentInformeLat = pos.coords.latitude;
        currentInformeLng = pos.coords.longitude;
        box.className = 'location-box ok';
        status.textContent = 'Ubicación obtenida';
        coords.textContent = currentInformeLat.toFixed(6) + ', ' + currentInformeLng.toFixed(6);
        updateInformeSaveButtonState();
      },
      function(err) {
        box.className = 'location-box err';
        var msg = 'No se pudo obtener la ubicación.';
        if (err && err.code === 1) msg = 'Ubicación denegada. Habilitá el permiso de ubicación para guardar el informe.';
        else if (err && err.code === 2) msg = 'Ubicación no disponible en este momento.';
        else if (err && err.code === 3) msg = 'Se agotó el tiempo esperando la ubicación.';
        status.textContent = msg;
        updateInformeSaveButtonState();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function updateInformeSaveButtonState() {
    var btn = document.getElementById('if-btn-save');
    if (!btn) return;
    var hasClient   = !!selectedInformeClienteCodigo;
    var hasLocation = currentInformeLat !== null && currentInformeLng !== null;
    btn.disabled = !(hasClient && hasLocation);
  }

  function clearInformeForm() {
    document.getElementById('if-cliente').value = '';
    clearClienteSelection('if-cliente');
    hideClienteSuggestions('if-cliente');
    document.getElementById('if-comentario').value = '';
    updateInformeSaveButtonState();
  }

  function saveInforme() {
    if (!selectedInformeClienteCodigo) {
      showToast('Elegí un cliente del listado', 'error');
      return;
    }
    if (currentInformeLat === null || currentInformeLng === null) {
      showToast('Se necesita la ubicación para guardar el informe', 'error');
      return;
    }
    var data = {
      codigoCliente: selectedInformeClienteCodigo,
      comentario: document.getElementById('if-comentario').value.trim(),
      lat: currentInformeLat,
      lng: currentInformeLng
    };
    var btn = document.getElementById('if-btn-save');
    var label = document.getElementById('if-save-label');
    btn.disabled = true; label.textContent = 'Guardando...';
    google.script.run
      .withSuccessHandler(function() {
        btn.disabled = false; label.textContent = 'Guardar informe';
        showToast('Informe guardado', 'success');
        clearInformeForm();
        captureInformeLocation(); // recapturar para la próxima visita
        loadInformes();
      })
      .withFailureHandler(handleAuthError(function(err) {
        updateInformeSaveButtonState();
        label.textContent = 'Guardar informe';
        showToast('Error: ' + (err ? err.message : 'desconocido'), 'error');
      }))
      .saveInforme(authToken, data);
  }

  // ── Tabla de Informes ──
  function loadInformes() {
    setTableLoading('panel-informes', true);
    google.script.run
      .withSuccessHandler(function(rows) {
        setTableLoading('panel-informes', false);
        renderInformes(rows || []);
      })
      .withFailureHandler(handleAuthError(function(err) {
        setTableLoading('panel-informes', false);
        var tbody = document.getElementById('informes-body');
        if (tbody) tbody.innerHTML =
          '<tr><td colspan="7" class="empty-table">Error al cargar: ' + (err ? err.message : 'desconocido') + '</td></tr>';
      }))
      .getInformes(authToken);
  }

  function renderInformes(rows) {
    allInformes = rows;
    informesCache = {};
    rows.forEach(function(r) { if (r['ID']) informesCache[r['ID']] = r; });
    informesCurrentPage = 1;
    populateSelectFilter('if-filter-cliente', rows, 'Cliente', 'Todos los clientes');
    populateSelectFilter('if-filter-usuario', rows, 'Usuario', 'Todos los usuarios');
    populateSelectFilter('if-filter-ciudad',  rows, 'Ciudad',  'Todas las ciudades');
    populateSelectFilter('if-filter-zona',    rows, 'Zona',    'Todas las zonas');
    updateInformeFiltersCount();
    applyInformeFilters();
    if (informesCurrentTab === 'mapa') renderInformesMap();
  }

  function getFilteredSortedInformes() {
    var searchEl = document.getElementById('if-search-input');
    var q = searchEl ? (searchEl.value || '').toLowerCase().trim() : '';
    var clientes = filterSelections['if-filter-cliente'] || [];
    var usuarios = filterSelections['if-filter-usuario'] || [];
    var ciudades = filterSelections['if-filter-ciudad']  || [];
    var zonas    = filterSelections['if-filter-zona']    || [];
    var fDesde = document.getElementById('if-filter-fecha-desde');
    var fHasta = document.getElementById('if-filter-fecha-hasta');
    var tsDesde = (fDesde && fDesde.value) ? new Date(fDesde.value + 'T00:00:00').getTime() : null;
    var tsHasta = (fHasta && fHasta.value) ? new Date(fHasta.value + 'T23:59:59').getTime() : null;
    var filtered = allInformes.filter(function(r) {
      if (clientes.length && clientes.indexOf(r['Cliente']) === -1) return false;
      if (usuarios.length && usuarios.indexOf(r['Usuario']) === -1) return false;
      if (ciudades.length && ciudades.indexOf(r['Ciudad'])  === -1) return false;
      if (zonas.length    && zonas.indexOf(r['Zona'])       === -1) return false;
      if (tsDesde !== null || tsHasta !== null) {
        var rTs = parseDateDMY(r['Fecha']);
        if (!rTs) return false;
        if (tsDesde !== null && rTs < tsDesde) return false;
        if (tsHasta !== null && rTs > tsHasta) return false;
      }
      if (!q) return true;
      return ['Cliente', 'Comentario', 'Usuario', 'Ciudad', 'Zona'].some(function(k) {
        return (r[k] || '').toLowerCase().indexOf(q) !== -1;
      });
    });
    if (informeSortState.column) {
      filtered = filtered.slice().sort(function(a, b) {
        var va = a[informeSortState.column], vb = b[informeSortState.column];
        var c = INFORME_DATE_COLS.indexOf(informeSortState.column) !== -1
          ? parseDateDMY(va) - parseDateDMY(vb)
          : String(va || '').toLowerCase().localeCompare(String(vb || '').toLowerCase(), 'es');
        return informeSortState.direction === 'asc' ? c : -c;
      });
    }
    return filtered;
  }

  function sortInformesBy(key) {
    if (informeSortState.column === key) {
      informeSortState.direction = informeSortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
      informeSortState.column = key;
      informeSortState.direction = 'asc';
    }
    informesCurrentPage = 1;
    applyInformeFilters();
  }

  function updateInformeSortIndicators() {
    var panel = document.getElementById('panel-informes');
    if (!panel) return;
    panel.querySelectorAll('.sort-ind').forEach(function(el) {
      if (el.getAttribute('data-key') === informeSortState.column) {
        el.classList.add('active');
        el.textContent = informeSortState.direction === 'asc' ? '▲' : '▼';
      } else {
        el.classList.remove('active');
        el.textContent = '⇅';
      }
    });
  }

  function changeInformePage(delta) {
    informesCurrentPage += delta;
    if (informesCurrentPage < 1) informesCurrentPage = 1;
    applyInformeFilters();
  }

  function applyInformeFilters() {
    var filtered = getFilteredSortedInformes();
    document.getElementById('if-kpi-count').textContent = filtered.length;
    updateInformeSortIndicators();

    var totalRows = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalRows / INFORMES_PAGE_SIZE));
    if (informesCurrentPage > totalPages) informesCurrentPage = totalPages;
    if (informesCurrentPage < 1) informesCurrentPage = 1;
    var startIdx = (informesCurrentPage - 1) * INFORMES_PAGE_SIZE;
    var endIdx = Math.min(startIdx + INFORMES_PAGE_SIZE, totalRows);
    var pageRows = filtered.slice(startIdx, endIdx);

    var pagBar = document.getElementById('if-pagination-bar');
    if (totalRows > 0) {
      pagBar.style.display = '';
      document.getElementById('if-pagination-info').textContent =
        'Mostrando ' + (startIdx + 1) + '–' + endIdx + ' de ' + totalRows;
      document.getElementById('if-pagination-page').textContent = informesCurrentPage + ' / ' + totalPages;
      document.getElementById('if-btn-page-prev').disabled = informesCurrentPage <= 1;
      document.getElementById('if-btn-page-next').disabled = informesCurrentPage >= totalPages;
    } else {
      pagBar.style.display = 'none';
    }

    var tbody = document.getElementById('informes-body');
    if (!filtered.length) {
      var hasAnyFilter = (document.getElementById('if-search-input').value || '').trim() ||
        (filterSelections['if-filter-cliente'] || []).length ||
        (filterSelections['if-filter-usuario'] || []).length ||
        (filterSelections['if-filter-ciudad']  || []).length ||
        (filterSelections['if-filter-zona']    || []).length ||
        (document.getElementById('if-filter-fecha-desde') || {}).value ||
        (document.getElementById('if-filter-fecha-hasta') || {}).value;
      tbody.innerHTML = '<tr><td colspan="7" class="empty-table">' +
        (hasAnyFilter ? 'Sin resultados para los filtros aplicados' : 'No hay informes cargados aún') +
        '</td></tr>';
      return;
    }
    tbody.innerHTML = pageRows.map(function(r) {
      var rid = esc(r['ID']);
      var hasCoords = r['Latitud'] !== '' && r['Longitud'] !== '' && r['Latitud'] != null && r['Longitud'] != null;
      var ubicCell = hasCoords
        ? '<a href="#" class="map-link" onclick="event.stopPropagation();openInformeInMap(\'' + rid + '\');return false;">Ver en mapa</a>'
        : '<span style="color:var(--gray-400)">—</span>';
      var comentario = String(r['Comentario'] || '');
      var comentarioShort = comentario.length > 60 ? comentario.slice(0, 60) + '…' : comentario;
      return '<tr data-id="' + rid + '" tabindex="0" role="button" aria-label="Ver informe" ' +
        'onclick="openInformeViewModal(\'' + rid + '\')" ' +
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openInformeViewModal(\'' + rid + '\');}">' +
        '<td>' + esc(r['Fecha']) + '</td>' +
        '<td title="' + esc(r['Cliente']) + '">' + esc(r['Cliente']) + '</td>' +
        '<td>' + esc(r['Ciudad']) + '</td>' +
        '<td>' + esc(r['Zona']) + '</td>' +
        '<td title="' + esc(comentario) + '">' + esc(comentarioShort) + '</td>' +
        '<td class="username-display">' + esc(r['Usuario']) + '</td>' +
        '<td>' + ubicCell + '</td>' +
      '</tr>';
    }).join('');
  }

  // ── Filtros de Informes ──
  var debouncedInformeFilterChange = debounce(onInformeFilterChange, 300);
  function onInformeFilterChange() {
    informesCurrentPage = 1;
    pendingInformeMapFocusId = null; // filtrar a mano vuelve a la vista general del mapa
    var qMes = document.getElementById('if-quick-mes'), q7d = document.getElementById('if-quick-7d');
    if (qMes) qMes.classList.remove('active');
    if (q7d) q7d.classList.remove('active');
    updateInformeFiltersCount();
    applyInformeFilters();
    if (informesCurrentTab === 'mapa') renderInformesMap();
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymdLocal(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  // Atajos de fecha en la pestaña Mapa: mes actual / últimos 7 días
  function applyInformeQuickDateFilter(kind) {
    var hoy = new Date();
    var desde;
    if (kind === 'mes') {
      desde = ymdLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    } else {
      var d7 = new Date(hoy);
      d7.setDate(d7.getDate() - 6); // incluye hoy: 7 días en total
      desde = ymdLocal(d7);
    }
    document.getElementById('if-filter-fecha-desde').value = desde;
    document.getElementById('if-filter-fecha-hasta').value = ymdLocal(hoy);
    onInformeFilterChange();
    var qMes = document.getElementById('if-quick-mes'), q7d = document.getElementById('if-quick-7d');
    if (qMes) qMes.classList.toggle('active', kind === 'mes');
    if (q7d) q7d.classList.toggle('active', kind === '7d');
  }
  function relocateInformeFiltersWrap(name) {
    var wrap = document.getElementById('if-filters-wrap');
    if (!wrap) return;
    var target = name === 'mapa'
      ? document.getElementById('if-filters-anchor-mapa')
      : document.getElementById('if-search-row');
    if (target && wrap.parentNode !== target) target.appendChild(wrap);
  }
  function toggleInformeFiltersPanel(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    var panel = document.getElementById('if-filters-panel');
    var btn = document.getElementById('if-btn-filters');
    var willShow = panel.hasAttribute('hidden');
    if (willShow) { panel.removeAttribute('hidden'); btn.classList.add('active'); keepFiltersPanelInViewport(panel); }
    else          { panel.setAttribute('hidden', ''); btn.classList.remove('active'); closeAllSdrops(); }
  }
  function clearAllInformeFilters() {
    ['if-filter-cliente', 'if-filter-usuario', 'if-filter-ciudad', 'if-filter-zona'].forEach(function(id) {
      filterSelections[id] = [];
      var hidden = document.getElementById(id);
      if (!hidden) return;
      var sdrop = hidden.closest('.sdrop');
      sdrop.querySelectorAll('.sdrop-option').forEach(function(o) {
        o.classList.remove('active');
        var ck = o.querySelector('.sdrop-check'); if (ck) ck.textContent = '';
      });
      updateSdropLabel(sdrop);
    });
    document.getElementById('if-search-input').value = '';
    var fd = document.getElementById('if-filter-fecha-desde'); if (fd) fd.value = '';
    var fh = document.getElementById('if-filter-fecha-hasta'); if (fh) fh.value = '';
    informeSortState = { column: null, direction: 'asc' };
    updateInformeFiltersCount();
    onInformeFilterChange();
  }
  function updateInformeFiltersCount() {
    var n = 0;
    ['if-filter-cliente', 'if-filter-usuario', 'if-filter-ciudad', 'if-filter-zona'].forEach(function(id) {
      if ((filterSelections[id] || []).length > 0) n++;
    });
    var fd = document.getElementById('if-filter-fecha-desde');
    var fh = document.getElementById('if-filter-fecha-hasta');
    if ((fd && fd.value) || (fh && fh.value)) n++;
    var badge = document.getElementById('if-filters-count');
    if (!badge) return;
    if (n > 0) { badge.style.display = ''; badge.textContent = n; }
    else        { badge.style.display = 'none'; }
  }

  // ── Mapa de visitas (Leaflet + OpenStreetMap) ──
  // Ícono circular por vendedor: su foto de perfil si tiene, si no la inicial
  // de su usuario (mismo criterio de fallback que el avatar del drawer).
  function informeMarkerIcon(r) {
    var username = String(r['Usuario'] || '');
    var initial = esc((username.charAt(0) || '?').toUpperCase());
    var foto = r['FotoUsuario'];
    var inner = foto
      ? '<img src="' + esc(foto) + '" alt="" data-initial="' + initial + '" onerror="handleInformeMarkerImgError(this)">'
      : '<span class="informe-marker-initial">' + initial + '</span>';
    return L.divIcon({
      html: '<div class="informe-marker">' + inner + '</div>',
      className: 'informe-marker-wrap',
      iconSize: [40, 48],
      iconAnchor: [20, 47],
      popupAnchor: [0, -44]
    });
  }
  function handleInformeMarkerImgError(img) {
    var span = document.createElement('span');
    span.className = 'informe-marker-initial';
    span.textContent = img.getAttribute('data-initial') || '?';
    img.parentNode.replaceChild(span, img);
  }

  function renderInformesMap() {
    var container = document.getElementById('informes-map');
    if (!container || typeof L === 'undefined') return;

    if (!informesMap) {
      informesMap = L.map(container).setView([-25.2637, -57.5759], 6); // Paraguay aprox., ajustado por fitBounds abajo
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(informesMap);
      // Agrupa markers cercanos en un círculo con contador; solo se "abren" en
      // marcadores individuales al hacer zoom. Evita renderizar cientos de
      // puntos superpuestos de una vez (ver discusión de rendimiento).
      informesClusterGroup = (typeof L.markerClusterGroup === 'function')
        ? L.markerClusterGroup({ maxClusterRadius: 60, spiderfyOnMaxZoom: true })
        : L.layerGroup();
      informesClusterGroup.addTo(informesMap);
    }

    informesClusterGroup.clearLayers();
    informesMarkers = [];

    var rows = getFilteredSortedInformes().filter(function(r) {
      var lat = parseFloat(r['Latitud']), lng = parseFloat(r['Longitud']);
      return isFinite(lat) && isFinite(lng);
    });


    var focusMarker = null;
    rows.forEach(function(r) {
      var lat = parseFloat(r['Latitud']), lng = parseFloat(r['Longitud']);
      var popup = '<b>' + esc(r['Cliente']) + '</b><br>' +
        esc(r['Fecha']) + ' · ' + esc(r['Usuario']) + '<br>' +
        (r['Comentario'] ? esc(r['Comentario']) : '<i>Sin comentario</i>');
      var marker = L.marker([lat, lng], { icon: informeMarkerIcon(r) }).bindPopup(popup);
      informesClusterGroup.addLayer(marker);
      marker._informeId = r['ID'];
      informesMarkers.push(marker);
      if (pendingInformeMapFocusId && r['ID'] === pendingInformeMapFocusId) focusMarker = marker;
    });

    if (focusMarker) {
      // Viene de "Ver en mapa": mantiene el zoom en ese punto aunque este
      // render se repita (p.ej. por un loadInformes() en segundo plano) hasta
      // que el usuario cambie de filtro o entre a Mapa de otra forma.
      if (typeof informesClusterGroup.zoomToShowLayer === 'function') {
        informesClusterGroup.zoomToShowLayer(focusMarker, function() {
          informesMap.setView(focusMarker.getLatLng(), 16);
          focusMarker.openPopup();
        });
      } else {
        informesMap.setView(focusMarker.getLatLng(), 16);
        focusMarker.openPopup();
      }
    } else if (rows.length) {
      var bounds = L.latLngBounds(rows.map(function(r) { return [parseFloat(r['Latitud']), parseFloat(r['Longitud'])]; }));
      informesMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    }
    setTimeout(function() { informesMap.invalidateSize(); }, 0);
  }

  // Desde la tabla: abre el mapa centrado/con popup en el informe elegido.
  // El foco queda "pegado" en renderInformesMap() aunque el panel se
  // vuelva a renderizar (ver pendingInformeMapFocusId).
  function openInformeInMap(id) {
    switchSection('informes');
    switchInformeTab('mapa', id);
  }

  // ── Modal Ver Informe ──
  function openInformeViewModal(id) {
    var r = informesCache[id];
    if (!r) return;
    viewingInformeId = id;
    document.getElementById('iv-record-id').textContent = 'ID: ' + id;
    document.getElementById('iv-cliente').textContent   = r['Cliente']   || '';
    document.getElementById('iv-usuario').textContent   = r['Usuario']   || '';
    document.getElementById('iv-fecha').textContent     = r['Fecha']     || '';
    document.getElementById('iv-ciudad').textContent    = r['Ciudad']    || '';
    document.getElementById('iv-zona').textContent       = r['Zona']      || '';
    document.getElementById('iv-comentario').textContent = r['Comentario'] || '';
    var codCli = String(r['Código Cliente'] || '').trim();
    var badge = document.getElementById('iv-cliente-codigo-badge');
    if (codCli) {
      badge.textContent = codCli; badge.className = 'cliente-badge'; badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none'; badge.textContent = '';
    }
    var lat = parseFloat(r['Latitud']), lng = parseFloat(r['Longitud']);
    var link = document.getElementById('iv-ubicacion-link');
    if (isFinite(lat) && isFinite(lng)) {
      link.href = 'https://www.google.com/maps?q=' + lat + ',' + lng;
      link.style.display = '';
      link.textContent = 'Ver en Google Maps (' + lat.toFixed(6) + ', ' + lng.toFixed(6) + ')';
    } else {
      link.removeAttribute('href');
      link.style.display = 'none';
    }
    document.getElementById('btn-iv-edit').style.display   = (authRol === 'Admin') ? '' : 'none';
    document.getElementById('btn-iv-delete').style.display = (authRol === 'Admin') ? '' : 'none';
    document.getElementById('modal-view-informe-overlay').classList.remove('hidden');
  }

  function closeInformeViewModal() {
    document.getElementById('modal-view-informe-overlay').classList.add('hidden');
    viewingInformeId = null;
  }

  function switchInformeViewToEdit() {
    if (!viewingInformeId) return;
    var id = viewingInformeId;
    closeInformeViewModal();
    editInforme(id);
  }

  function deleteCurrentInforme() {
    if (!viewingInformeId) return;
    if (authRol !== 'Admin') return;
    var id = viewingInformeId;
    var r = informesCache[id] || {};
    var info = [];
    if (r['Cliente']) info.push(r['Cliente']);
    if (r['Fecha'])   info.push(r['Fecha']);
    showConfirm({
      title: 'Eliminar informe',
      message: '¿Confirmás que querés eliminar este informe de visita? Esta acción no se puede deshacer.',
      items: info,
      requireWord: 'eliminar',
      okText: 'Eliminar',
      cancelText: 'Cancelar'
    }).then(function(ok) {
      if (!ok) return;
      var btn = document.getElementById('btn-iv-delete');
      btn.disabled = true; btn.textContent = 'Eliminando...';
      google.script.run
        .withSuccessHandler(function() {
          btn.disabled = false; btn.textContent = 'Borrar';
          showToast('Informe eliminado', 'success');
          closeInformeViewModal();
          loadInformes();
        })
        .withFailureHandler(handleAuthError(function(err) {
          btn.disabled = false; btn.textContent = 'Borrar';
          showToast('Error: ' + (err ? err.message : 'desconocido'), 'error');
        }))
        .deleteInforme(authToken, id);
    });
  }

  document.getElementById('modal-view-informe-overlay').addEventListener('mousedown', function(e) {
    if (e.target === this) closeInformeViewModal();
  });

  // ── Editar Informe (Admin only) ──
  function editInforme(id) {
    var r = informesCache[id];
    if (!r) return;
    editingInformeId = id;
    document.getElementById('edit-informe-id').textContent = 'ID: ' + id;
    document.getElementById('ie-cliente').value = r['Cliente'] || '';
    clearClienteSelection('ie-cliente');
    hideClienteSuggestions('ie-cliente');
    var codPrev = String(r['Código Cliente'] || '').trim();
    if (codPrev) {
      var match = allClients.find(function(c) { return String(c.codigo || '').toLowerCase() === codPrev.toLowerCase(); });
      if (match) {
        selectedEditInformeClienteCodigo = match.codigo;
        var badge = document.getElementById('ie-cliente-codigo-badge');
        if (badge) { badge.textContent = match.codigo; badge.className = 'cliente-badge'; badge.style.display = 'inline-block'; }
      }
    }
    document.getElementById('ie-comentario').value = r['Comentario'] || '';
    var meo = document.getElementById('modal-edit-informe-overlay');
    meo.classList.remove('hidden');
    focusFirstField(meo);
  }

  function closeInformeEditModal() {
    document.getElementById('modal-edit-informe-overlay').classList.add('hidden');
    editingInformeId = null;
    clearClienteSelection('ie-cliente');
    hideClienteSuggestions('ie-cliente');
  }

  function saveInformeEdit() {
    if (!editingInformeId) return;
    if (!selectedEditInformeClienteCodigo) {
      var input = document.getElementById('ie-cliente');
      input.classList.add('field-missing');
      setTimeout(function() { input.classList.remove('field-missing'); }, 500);
      showToast('Elegí un cliente del listado', 'error');
      return;
    }
    var data = {
      codigoCliente: selectedEditInformeClienteCodigo,
      comentario: document.getElementById('ie-comentario').value.trim()
    };
    var btn = document.getElementById('btn-informe-edit-save');
    btn.disabled = true; btn.textContent = 'Guardando...';
    google.script.run
      .withSuccessHandler(function() {
        btn.disabled = false; btn.textContent = 'Guardar cambios';
        showToast('Informe actualizado', 'success');
        closeInformeEditModal();
        loadInformes();
      })
      .withFailureHandler(handleAuthError(function(err) {
        btn.disabled = false; btn.textContent = 'Guardar cambios';
        showToast('Error: ' + (err ? err.message : 'desconocido'), 'error');
      }))
      .updateInforme(authToken, editingInformeId, data);
  }

  document.getElementById('modal-edit-informe-overlay').addEventListener('mousedown', function(e) {
    if (e.target === this) closeInformeEditModal();
  });

  // ────────────────────────────────────────────
  // CLIENTES — Gestión (Admin only)
  // ────────────────────────────────────────────
  function loadClientes() {
    setTableLoading('panel-clientes', true);
    google.script.run
      .withSuccessHandler(function(rows) {
        setTableLoading('panel-clientes', false);
        allClients = rows || [];
        populateSelectFilter('filter-cliente-ciudad', allClients, 'ciudad', 'Todas las ciudades');
        populateSelectFilter('filter-cliente-zona',   allClients, 'zona',   'Todas las zonas');
        updateClienteFiltersCount();
        renderClientes();
      })
      .withFailureHandler(handleAuthError(function(err) {
        setTableLoading('panel-clientes', false);
        document.getElementById('clientes-body').innerHTML =
          '<tr><td colspan="4" class="empty-table">Error: ' + (err ? err.message : '') + '</td></tr>';
      }))
      .listClients(authToken);
  }

  // Filtra allClients por el buscador de texto + los sdrops de Ciudad/Zona. Compartido entre
  // renderClientes() (tabla) y getClienteViewNavList() (prev/next del modal detalle) para que
  // ambos reflejen exactamente el mismo conjunto filtrado.
  function getFilteredClientRows() {
    var q = (document.getElementById('search-clientes').value || '').toLowerCase().trim();
    var selCiudad = filterSelections['filter-cliente-ciudad'] || [];
    var selZona   = filterSelections['filter-cliente-zona']   || [];
    return allClients.filter(function(c) {
      if (q) {
        var matchQ = String(c.codigo || '').toLowerCase().indexOf(q) !== -1
            || String(c.razonSocial || '').toLowerCase().indexOf(q) !== -1
            || String(c.nombreFantasia || '').toLowerCase().indexOf(q) !== -1
            || String(c.ciudad || '').toLowerCase().indexOf(q) !== -1
            || String(c.zona || '').toLowerCase().indexOf(q) !== -1;
        if (!matchQ) return false;
      }
      if (selCiudad.length && selCiudad.indexOf(c.ciudad) === -1) return false;
      if (selZona.length && selZona.indexOf(c.zona) === -1) return false;
      return true;
    });
  }

  function renderClientes() {
    clientesCache = {};
    allClients.forEach(function(c) {
      if (c.codigo) clientesCache[String(c.codigo).toLowerCase()] = c;
    });
    var rows = getFilteredClientRows();
    rows = rows.slice().sort(function(a, b) {
      // Orden por código de mayor a menor (descendente). numeric:true para que "10" > "9"
      return String(b.codigo || '').localeCompare(String(a.codigo || ''), 'es', { numeric: true });
    });
    var tbody = document.getElementById('clientes-body');
    if (!rows.length) {
      var hasFilter = !!(document.getElementById('search-clientes').value || '').trim()
        || (filterSelections['filter-cliente-ciudad'] || []).length
        || (filterSelections['filter-cliente-zona']   || []).length;
      tbody.innerHTML = '<tr><td colspan="5" class="empty-table">' +
        (hasFilter ? 'Sin resultados' : 'No hay clientes cargados') + '</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function(c) {
      var safeCod = esc(c.codigo);
      return '<tr data-cod="' + safeCod + '" tabindex="0" role="button" aria-label="Ver cliente" ' +
        'onclick="openViewClienteModal(\'' + safeCod + '\')" ' +
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openViewClienteModal(\'' + safeCod + '\');}">' +
        '<td style="font-weight:700;color:var(--primary)">' + safeCod + '</td>' +
        '<td style="font-weight:600">' + esc(c.razonSocial) + '</td>' +
        '<td>' + esc(c.nombreFantasia || '') + '</td>' +
        '<td>' + esc(c.ciudad || '') + '</td>' +
        '<td>' + esc(c.zona || '') + '</td>' +
      '</tr>';
    }).join('');
  }

  function openNewClienteModal() {
    editingClienteCodigo = null;
    document.getElementById('cliente-modal-title').textContent = 'Nuevo Cliente';
    document.getElementById('c-codigo').value = '';
    document.getElementById('c-codigo').disabled = false;
    document.getElementById('c-razon').value = '';
    document.getElementById('c-fantasia').value = '';
    document.getElementById('c-ciudad').value = '';
    document.getElementById('c-zona').value = '';
    document.getElementById('modal-cliente-overlay').classList.remove('hidden');
    setTimeout(function() { document.getElementById('c-codigo').focus(); }, 80);
  }

  function openEditClienteModal(codigo) {
    var c = clientesCache[String(codigo).toLowerCase()];
    if (!c) return;
    editingClienteCodigo = c.codigo;
    document.getElementById('cliente-modal-title').textContent = 'Editar Cliente';
    document.getElementById('c-codigo').value = c.codigo || '';
    document.getElementById('c-codigo').disabled = false;
    document.getElementById('c-razon').value = c.razonSocial || '';
    document.getElementById('c-fantasia').value = c.nombreFantasia || '';
    document.getElementById('c-ciudad').value = c.ciudad || '';
    document.getElementById('c-zona').value = c.zona || '';
    var mco = document.getElementById('modal-cliente-overlay');
    mco.classList.remove('hidden');
    focusFirstField(mco);
  }

  function closeClienteModal() {
    document.getElementById('modal-cliente-overlay').classList.add('hidden');
    editingClienteCodigo = null;
  }

  // ────────────────────────────────────────────
  // VIEW CLIENTE (solo lectura, todos los usuarios)
  // ────────────────────────────────────────────
  var viewingClienteCodigo = null;

  function openViewClienteModal(codigo) {
    var c = clientesCache[String(codigo).toLowerCase()];
    if (!c) return;
    viewingClienteCodigo = c.codigo;
    document.getElementById('vc-codigo').textContent   = c.codigo || '';
    document.getElementById('vc-razon').textContent    = c.razonSocial || '';
    document.getElementById('vc-fantasia').textContent = c.nombreFantasia || '';
    document.getElementById('vc-ciudad').textContent   = c.ciudad || '';
    document.getElementById('vc-zona').textContent     = c.zona || '';
    document.getElementById('btn-view-cliente-edit').style.display   = (authRol === 'Admin') ? '' : 'none';
    document.getElementById('btn-view-cliente-delete').style.display = (authRol === 'Admin') ? '' : 'none';
    renderClienteOrdersStats(c);
    updateClienteViewNavState();
    document.getElementById('modal-view-cliente-overlay').classList.remove('hidden');
  }

  // Pedidos del cliente visibles para el usuario actual: allRecords ya viene filtrado
  // por rol desde el backend (User ve solo los suyos, Admin/AdminL ven todos).
  function getClientOrders(c) {
    var cod = String(c.codigo || '').trim().toLowerCase();
    var raz = String(c.razonSocial || '').trim().toLowerCase();
    var list = (allRecords || []).filter(function(r) {
      var rCod = String(r['Código Cliente'] || '').trim().toLowerCase();
      if (rCod) return rCod === cod;
      return String(r['Cliente'] || '').trim().toLowerCase() === raz;
    });
    return list.slice().sort(function(a, b) {
      return (parseDateDMY(b['Fecha Carga']) || 0) - (parseDateDMY(a['Fecha Carga']) || 0);
    });
  }

  function renderClienteOrdersStats(c) {
    var orders = getClientOrders(c);
    var pares = 0, monto = 0;
    orders.forEach(function(o) {
      pares += parseAmount(o['Total Pares']);
      monto += parseAmount(o['Total Precio']);
    });
    document.getElementById('vc-stat-count').textContent = orders.length;
    document.getElementById('vc-stat-pares').textContent = formatAmount(pares);
    document.getElementById('vc-stat-monto').textContent = 'Gs. ' + formatAmount(monto);
    document.getElementById('vc-orders-title').textContent =
      (authRol === 'Admin' || authRol === 'AdminL') ? 'Pedidos de este cliente' : 'Tus pedidos con este cliente';

    // Para User (que solo ve sus propios pedidos), sumamos aparte el total general
    // del cliente entre todos los vendedores, consultando al backend.
    var globalCard = document.getElementById('vc-kpi-global');
    if (authRol === 'User') {
      globalCard.style.display = '';
      var globalEl = document.getElementById('vc-stat-global-monto');
      globalEl.textContent = '…';
      var codigo = c.codigo;
      google.script.run
        .withSuccessHandler(function(res) {
          if (viewingClienteCodigo !== codigo) return; // el usuario ya navegó a otro cliente
          globalEl.textContent = 'Gs. ' + formatAmount((res && res.total) || 0);
        })
        .withFailureHandler(function() {
          if (viewingClienteCodigo !== codigo) return;
          globalEl.textContent = '—';
        })
        .getClientGlobalTotal(authToken, codigo, c.razonSocial);
    } else {
      globalCard.style.display = 'none';
    }

    var box = document.getElementById('vc-orders-list');
    if (!orders.length) {
      box.innerHTML = '<div class="rep-empty">Sin pedidos registrados</div>';
      return;
    }
    box.innerHTML = orders.map(function(o) {
      var rid = esc(o['ID']);
      return '<div class="vc-order-row" role="button" tabindex="0" aria-label="Ver pedido" ' +
        'onclick="openClienteOrderDetail(\'' + rid + '\')" ' +
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openClienteOrderDetail(\'' + rid + '\');}">' +
        '<span class="vc-order-orden">' + esc(o['N° Orden'] || '—') + '</span>' +
        '<span class="vc-order-fecha">' + esc(o['Fecha Carga'] || '') + '</span>' +
        '<span class="vc-order-marca">' + esc(o['Marca'] || '') + '</span>' +
        '<span class="vc-order-total">Gs ' + formatAmount(parseAmount(o['Total Precio'])) + '</span>' +
      '</div>';
    }).join('');
  }

  function openClienteOrderDetail(id) {
    closeViewClienteModal();
    selectRow(id);
    openViewModal(id);
  }

  function getClienteViewNavList() {
    return getFilteredClientRows().slice().sort(function(a, b) {
      return String(b.codigo || '').localeCompare(String(a.codigo || ''), 'es', { numeric: true });
    });
  }

  function updateClienteViewNavState() {
    var list = getClienteViewNavList();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].codigo === viewingClienteCodigo) { idx = i; break; }
    }
    var prevBtn = document.getElementById('view-cliente-prev-btn');
    var nextBtn = document.getElementById('view-cliente-next-btn');
    var posEl   = document.getElementById('view-cliente-nav-pos');
    if (idx === -1 || list.length === 0) {
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      if (posEl)   posEl.textContent = '';
      return;
    }
    if (prevBtn) prevBtn.disabled = (idx === 0);
    if (nextBtn) nextBtn.disabled = (idx === list.length - 1);
    if (posEl)   posEl.textContent = (idx + 1) + ' / ' + list.length;
  }

  function navigateClienteView(direction) {
    if (!viewingClienteCodigo) return;
    var list = getClienteViewNavList();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].codigo === viewingClienteCodigo) { idx = i; break; }
    }
    if (idx === -1) return;
    var next = idx + direction;
    if (next < 0 || next >= list.length) return;
    openViewClienteModal(list[next].codigo);
  }

  function closeViewClienteModal() {
    document.getElementById('modal-view-cliente-overlay').classList.add('hidden');
    viewingClienteCodigo = null;
  }

  function switchClienteViewToEdit() {
    if (!viewingClienteCodigo) return;
    var codigo = viewingClienteCodigo;
    closeViewClienteModal();
    openEditClienteModal(codigo);
  }

  function deleteCurrentCliente() {
    if (!viewingClienteCodigo) return;
    if (authRol !== 'Admin') return;
    var codigo = viewingClienteCodigo;
    var c = clientesCache[String(codigo).toLowerCase()] || {};
    var info = [];
    if (c.codigo)      info.push('Código: ' + c.codigo);
    if (c.razonSocial) info.push(c.razonSocial);
    showConfirm({
      title: 'Eliminar cliente',
      message: '¿Confirmás que querés eliminar este cliente? Esta acción no se puede deshacer.',
      items: info,
      requireWord: 'eliminar',
      okText: 'Eliminar',
      cancelText: 'Cancelar'
    }).then(function(ok) {
      if (!ok) return;
      var btn = document.getElementById('btn-view-cliente-delete');
      btn.disabled = true; btn.textContent = 'Eliminando...';
      google.script.run
        .withSuccessHandler(function() {
          btn.disabled = false; btn.textContent = 'Borrar';
          showToast('Cliente eliminado', 'success');
          closeViewClienteModal();
          loadClientes();
          refreshClientsCache();
        })
        .withFailureHandler(handleAuthError(function(err) {
          btn.disabled = false; btn.textContent = 'Borrar';
          showToast('Error: ' + (err ? err.message : 'desconocido'), 'error');
        }))
        .deleteClient(authToken, codigo);
    });
  }

  document.getElementById('modal-view-cliente-overlay').addEventListener('mousedown', function(e) {
    if (e.target === this) closeViewClienteModal();
  });

  document.addEventListener('keydown', function(e) {
    var overlay = document.getElementById('modal-view-cliente-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); navigateClienteView(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigateClienteView(1);  }
  });

  function saveCliente() {
    var data = {
      codigo:         document.getElementById('c-codigo').value.trim(),
      razonSocial:    document.getElementById('c-razon').value.trim(),
      nombreFantasia: document.getElementById('c-fantasia').value.trim(),
      ciudad:         document.getElementById('c-ciudad').value.trim(),
      zona:           document.getElementById('c-zona').value.trim()
    };
    var btn = document.getElementById('btn-cliente-save');
    btn.disabled = true; btn.textContent = 'Guardando...';
    var done = function(msg) {
      btn.disabled = false; btn.textContent = 'Guardar';
      closeClienteModal();
      loadClientes();
      refreshClientsCache(); // mantener autocomplete sincronizado
      showToast(msg, 'success');
    };
    var fail = function(err) {
      btn.disabled = false; btn.textContent = 'Guardar';
      showToast('Error: ' + (err ? err.message : ''), 'error');
    };
    if (editingClienteCodigo) {
      google.script.run
        .withSuccessHandler(function() { done('Cliente actualizado'); })
        .withFailureHandler(handleAuthError(fail))
        .updateClient(authToken, editingClienteCodigo, data);
    } else {
      google.script.run
        .withSuccessHandler(function() { done('Cliente creado'); })
        .withFailureHandler(handleAuthError(fail))
        .createClient(authToken, data);
    }
  }

  document.getElementById('modal-cliente-overlay').addEventListener('mousedown', function(e) {
    if (e.target === this) closeClienteModal();
  });

  // ────────────────────────────────────────────
  // CONFIRM MODAL (reemplaza al confirm() nativo)
  // ────────────────────────────────────────────
  var _confirmResolve = null;
  var _confirmRequireWord = null;
  function showConfirm(opts) {
    opts = opts || {};
    var overlay = document.getElementById('confirm-overlay');
    document.getElementById('confirm-title').textContent = opts.title || 'Atención';
    var body = document.getElementById('confirm-body');
    var html = '';
    if (opts.message) html += '<p class="confirm-message">' + esc(opts.message) + '</p>';
    if (opts.items && opts.items.length) {
      html += '<div class="confirm-list">';
      opts.items.forEach(function(it) {
        html += '<div class="confirm-list-item">' + esc(it) + '</div>';
      });
      html += '</div>';
      if (opts.more) html += '<div class="confirm-list-more">' + esc(opts.more) + '</div>';
    }
    if (opts.question) html += '<p class="confirm-question">' + esc(opts.question) + '</p>';
    _confirmRequireWord = opts.requireWord ? String(opts.requireWord) : null;
    if (_confirmRequireWord) {
      html += '<p class="confirm-type-hint">Escribí <code>' + esc(_confirmRequireWord) + '</code> para confirmar:</p>';
      html += '<input type="text" id="confirm-type-input" class="confirm-type-input" autocomplete="off" spellcheck="false">';
    }
    body.innerHTML = html;
    var okBtn = document.getElementById('confirm-btn-ok');
    okBtn.textContent = opts.okText || 'Continuar';
    document.getElementById('confirm-btn-cancel').textContent = opts.cancelText || 'Cancelar';
    if (_confirmRequireWord) {
      okBtn.disabled = true;
      var typeInput = document.getElementById('confirm-type-input');
      typeInput.addEventListener('input', function() {
        okBtn.disabled = (typeInput.value.trim().toLowerCase() !== _confirmRequireWord.toLowerCase());
      });
      setTimeout(function() { typeInput.focus(); }, 50);
    } else {
      okBtn.disabled = false;
    }
    overlay.classList.remove('hidden');
    return new Promise(function(resolve) { _confirmResolve = resolve; });
  }
  function _closeConfirm(result) {
    document.getElementById('confirm-overlay').classList.add('hidden');
    document.getElementById('confirm-btn-ok').disabled = false;
    _confirmRequireWord = null;
    if (_confirmResolve) { var r = _confirmResolve; _confirmResolve = null; r(result); }
  }
  document.getElementById('confirm-btn-ok').addEventListener('click', function() {
    if (this.disabled) return;
    _closeConfirm(true);
  });
  document.getElementById('confirm-btn-cancel').addEventListener('click', function() { _closeConfirm(false); });
  document.getElementById('confirm-overlay').addEventListener('click', function(e) {
    if (e.target === this) _closeConfirm(false);
  });
  document.addEventListener('keydown', function(e) {
    var ov = document.getElementById('confirm-overlay');
    if (!ov || ov.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); _closeConfirm(false); }
    if (e.key === 'Enter')  {
      var okBtn = document.getElementById('confirm-btn-ok');
      if (okBtn.disabled) return;
      e.preventDefault(); _closeConfirm(true);
    }
  });

  // ────────────────────────────────────────────
  // FIELD ERROR ANIMATION
  // ────────────────────────────────────────────
  function flashMissingFields(ids) {
    if (!ids || !ids.length) return;
    var first = null;
    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (!first) first = el;
      var group = el.closest('.form-group') || el;
      group.classList.remove('field-missing');
      // Reflow para reiniciar la animación si ya estaba aplicada
      void group.offsetWidth;
      group.classList.add('field-missing');
      setTimeout(function() { group.classList.remove('field-missing'); }, 1400);
    });
    if (first) {
      try { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) {}
      setTimeout(function() { try { first.focus(); } catch(e) {} }, 250);
    }
  }

  // ────────────────────────────────────────────
  // TOAST
  // ────────────────────────────────────────────
  function showToast(msg, type) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show ' + (type || '');
    setTimeout(function() { t.className = ''; }, 3200);
  }

