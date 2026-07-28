// ── Revisiones de datos ──
// Un contador por hoja en PropertiesService (no en la hoja misma), para que
// el frontend pueda preguntar "¿cambió algo?" sin leer la hoja completa.
// Se incrementa en cada create/update/delete de esa hoja (ver bumpRevision()
// en Orders.gs, Informes.gs, Clients.gs, Users.gs). getRevisions() lo expone
// vía API para que el cliente decida si vale la pena volver a pedir la tabla
// entera o si puede seguir usando lo que ya tiene cacheado localmente.

function bumpRevision(key) {
  var props = PropertiesService.getScriptProperties();
  var current = Number(props.getProperty('rev_' + key)) || 0;
  props.setProperty('rev_' + key, String(current + 1));
}

function getRevisions(token) {
  requireSession(token);
  var props = PropertiesService.getScriptProperties();
  return {
    orders:   Number(props.getProperty('rev_orders'))   || 0,
    informes: Number(props.getProperty('rev_informes')) || 0,
    clients:  Number(props.getProperty('rev_clients'))  || 0,
    users:    Number(props.getProperty('rev_users'))     || 0
  };
}
