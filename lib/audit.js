'use strict';

const db = require('../db');

const insertAudit = db.prepare(`
  INSERT INTO audit_log (usuario, entidad, entidad_id, accion, detalle)
  VALUES (@usuario, @entidad, @entidad_id, @accion, @detalle)
`);

// Registra un cambio en el log de auditoría.
// req: para tomar el usuario logueado. accion: 'crear' | 'editar' | 'eliminar' | ...
function registrar(req, entidad, entidadId, accion, detalle) {
  const usuario = (req.session && req.session.user && req.session.user.nombre) || 'desconocido';
  insertAudit.run({
    usuario,
    entidad,
    entidad_id: entidadId != null ? Number(entidadId) : null,
    accion,
    detalle: detalle ? String(detalle).slice(0, 500) : null,
  });
  return usuario;
}

// Marca "última modificación" en tablas que tienen esas columnas (tareas).
function tocarTarea(req, tareaId) {
  const usuario = (req.session && req.session.user && req.session.user.nombre) || 'desconocido';
  db.prepare(`
    UPDATE tareas
    SET ultima_modificacion_por = ?, ultima_modificacion_en = datetime('now')
    WHERE id = ?
  `).run(usuario, tareaId);
}

// Historial de un registro puntual.
function historial(entidad, entidadId) {
  return db.prepare(`
    SELECT * FROM audit_log
    WHERE entidad = ? AND entidad_id = ?
    ORDER BY fecha DESC, id DESC
  `).all(entidad, Number(entidadId));
}

// Última entrada de auditoría de un registro.
function ultimaModificacion(entidad, entidadId) {
  return db.prepare(`
    SELECT usuario, accion, fecha FROM audit_log
    WHERE entidad = ? AND entidad_id = ?
    ORDER BY fecha DESC, id DESC
    LIMIT 1
  `).get(entidad, Number(entidadId));
}

module.exports = { registrar, tocarTarea, historial, ultimaModificacion };
