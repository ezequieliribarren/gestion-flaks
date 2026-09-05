'use strict';

const express = require('express');
const db = require('../db');
const audit = require('../lib/audit');

const router = express.Router();

const ESTADOS = ['activo', 'potencial', 'inactivo'];

function repartoValido(g, e) {
  const rg = Number(g);
  const re = Number(e);
  if (isNaN(rg) || isNaN(re) || rg < 0 || re < 0) return null;
  return { rg, re };
}

// estado_efectivo: un cliente inactivo con un trabajo único "potencial" figura como potencial.
const ESTADO_EFECTIVO = `
  CASE WHEN c.estado = 'inactivo'
        AND EXISTS (SELECT 1 FROM trabajos_unicos WHERE cliente_id = c.id AND estado = 'potencial')
       THEN 'potencial' ELSE c.estado END`;

router.get('/', (req, res) => {
  const vista = req.query.vista === 'lista' ? 'lista' : 'carpetas';
  // Filtro por estado: por defecto "activo". 'todos' muestra todo.
  let filtroEstado = 'activo';
  if (req.query.estado === 'todos') filtroEstado = null;
  else if (ESTADOS.includes(req.query.estado)) filtroEstado = req.query.estado;

  const orden = req.query.orden === 'facturacion' ? 'facturacion' : 'nombre';
  const ordenSql = orden === 'facturacion'
    ? 'total_facturado DESC, nombre COLLATE NOCASE'
    : `CASE estado_efectivo WHEN 'activo' THEN 0 WHEN 'potencial' THEN 1 ELSE 2 END, nombre COLLATE NOCASE`;

  const clientes = db.prepare(`
    SELECT * FROM (
      SELECT c.*,
        (SELECT COALESCE(SUM(monto_mensual),0) FROM trabajos_recurrentes WHERE cliente_id = c.id AND activo = 1) AS mensual,
        (SELECT COALESCE(SUM(monto_mensual),0) FROM trabajos_recurrentes WHERE cliente_id = c.id AND activo = 1)
          + (SELECT COALESCE(SUM(monto),0) FROM trabajos_unicos WHERE cliente_id = c.id AND estado = 'realizado') AS total_facturado,
        (SELECT COUNT(*) FROM tareas WHERE cliente_id = c.id AND estado != 'completada') AS tareas_abiertas,
        (SELECT COUNT(*) FROM trabajos_unicos WHERE cliente_id = c.id AND estado = 'potencial') AS trabajos_potenciales,
        ${ESTADO_EFECTIVO} AS estado_efectivo
      FROM clientes c
    )
    ${filtroEstado ? 'WHERE estado_efectivo = ?' : ''}
    ORDER BY ${ordenSql}
  `).all(...(filtroEstado ? [filtroEstado] : []));

  const conteo = db.prepare(`
    SELECT
      SUM(ee = 'activo')    AS activo,
      SUM(ee = 'potencial') AS potencial,
      SUM(ee = 'inactivo')  AS inactivo,
      COUNT(*)              AS total
    FROM (SELECT ${ESTADO_EFECTIVO} AS ee FROM clientes c)
  `).get();

  res.render('clientes/index', { titulo: 'Clientes', clientes, vista, filtroEstado, orden, conteo });
});

router.get('/nuevo', (req, res) => {
  res.render('clientes/form', { titulo: 'Nuevo cliente', cliente: {}, ESTADOS });
});

router.post('/', (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : '#2563eb';
  const estado = ESTADOS.includes(req.body.estado) ? req.body.estado : 'potencial';
  if (!nombre) { req.session.flash = { tipo: 'error', msg: 'El nombre es obligatorio.' }; return res.redirect('/clientes/nuevo'); }
  const info = db.prepare(
    'INSERT INTO clientes (nombre, color, estado, creado_por) VALUES (?, ?, ?, ?)'
  ).run(nombre, color, estado, req.session.user.nombre);
  audit.registrar(req, 'clientes', info.lastInsertRowid, 'crear', `Creó el cliente "${nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Cliente creado.' };
  res.redirect('/clientes/' + info.lastInsertRowid);
});

router.get('/:id', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'El cliente no existe.' });

  const recurrentes = db.prepare('SELECT * FROM trabajos_recurrentes WHERE cliente_id = ? ORDER BY activo DESC, nombre').all(cliente.id);
  const unicos = db.prepare('SELECT * FROM trabajos_unicos WHERE cliente_id = ? ORDER BY fecha DESC').all(cliente.id);
  const mensualTotal = recurrentes.filter((r) => r.activo).reduce((a, r) => a + r.monto_mensual, 0);

  const d = new Date();
  const mesPrefijo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const tareasMes = db.prepare(`
    SELECT * FROM tareas
    WHERE cliente_id = ? AND fecha_cierre IS NOT NULL AND substr(fecha_cierre,1,7) = ?
    ORDER BY estado, fecha_cierre
  `).all(cliente.id, mesPrefijo);

  res.render('clientes/detalle', {
    titulo: cliente.nombre,
    cliente,
    recurrentes,
    unicos,
    mensualTotal,
    tareasMes,
    ESTADOS,
    ultima: audit.ultimaModificacion('clientes', cliente.id),
    historial: audit.historial('clientes', cliente.id),
  });
});

router.post('/:id', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  const nombre = String(req.body.nombre || '').trim() || cliente.nombre;
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : cliente.color;
  const estado = ESTADOS.includes(req.body.estado) ? req.body.estado : cliente.estado;
  db.prepare('UPDATE clientes SET nombre = ?, color = ?, estado = ? WHERE id = ?').run(nombre, color, estado, cliente.id);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Editó el cliente "${nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Cliente actualizado.' };
  res.redirect('/clientes/' + cliente.id);
});

router.post('/:id/notas', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  db.prepare('UPDATE clientes SET notas = ? WHERE id = ?').run(String(req.body.notas || ''), cliente.id);
  audit.registrar(req, 'clientes', cliente.id, 'editar', 'Actualizó las anotaciones');
  req.session.flash = { tipo: 'ok', msg: 'Anotaciones guardadas.' };
  res.redirect('/clientes/' + cliente.id);
});

router.post('/:id/eliminar', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  db.prepare('DELETE FROM clientes WHERE id = ?').run(cliente.id);
  audit.registrar(req, 'clientes', cliente.id, 'eliminar', `Eliminó el cliente "${cliente.nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Cliente eliminado.' };
  res.redirect('/clientes');
});

// --- Trabajos recurrentes ---
router.post('/:id/recurrentes', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  const nombre = String(req.body.nombre || '').trim();
  const monto = Number(req.body.monto_mensual || 0);
  const rep = repartoValido(req.body.reparto_german, req.body.reparto_ezequiel);
  const dia = req.body.dia_de_cobro ? Math.min(28, Math.max(1, Number(req.body.dia_de_cobro))) : null;
  if (!nombre || !rep) { req.session.flash = { tipo: 'error', msg: 'Datos del trabajo recurrente inválidos.' }; return res.redirect('/clientes/' + cliente.id); }
  const info = db.prepare(`
    INSERT INTO trabajos_recurrentes (cliente_id, nombre, monto_mensual, reparto_german, reparto_ezequiel, activo, dia_de_cobro)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(cliente.id, nombre, monto, rep.rg, rep.re, dia);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Agregó trabajo recurrente "${nombre}" (${monto})`);
  req.session.flash = { tipo: 'ok', msg: 'Trabajo recurrente agregado.' };
  res.redirect('/clientes/' + cliente.id + '#recurrentes');
});

router.post('/:id/recurrentes/:tid', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  const t = db.prepare('SELECT * FROM trabajos_recurrentes WHERE id = ? AND cliente_id = ?').get(req.params.tid, req.params.id);
  if (!cliente || !t) return res.redirect('/clientes');
  if (req.body._accion === 'eliminar') {
    db.prepare('DELETE FROM trabajos_recurrentes WHERE id = ?').run(t.id);
    audit.registrar(req, 'clientes', cliente.id, 'editar', `Eliminó trabajo recurrente "${t.nombre}"`);
    req.session.flash = { tipo: 'ok', msg: 'Trabajo recurrente eliminado.' };
    return res.redirect('/clientes/' + cliente.id + '#recurrentes');
  }
  const nombre = String(req.body.nombre || '').trim() || t.nombre;
  const monto = req.body.monto_mensual != null ? Number(req.body.monto_mensual) : t.monto_mensual;
  const rep = repartoValido(req.body.reparto_german, req.body.reparto_ezequiel) || { rg: t.reparto_german, re: t.reparto_ezequiel };
  const activo = req.body.activo === '1' || req.body.activo === 'on' ? 1 : 0;
  const dia = req.body.dia_de_cobro ? Math.min(28, Math.max(1, Number(req.body.dia_de_cobro))) : null;
  db.prepare(`
    UPDATE trabajos_recurrentes SET nombre=?, monto_mensual=?, reparto_german=?, reparto_ezequiel=?, activo=?, dia_de_cobro=?
    WHERE id=?
  `).run(nombre, monto, rep.rg, rep.re, activo, dia, t.id);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Editó trabajo recurrente "${nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Trabajo recurrente actualizado.' };
  res.redirect('/clientes/' + cliente.id + '#recurrentes');
});

// --- Trabajos únicos ---
const ESTADOS_TRABAJO = ['realizado', 'potencial'];

router.post('/:id/unicos', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  const nombre = String(req.body.nombre || '').trim();
  const monto = Number(req.body.monto || 0);
  const fecha = req.body.fecha ? String(req.body.fecha).slice(0, 10) : null;
  const rep = repartoValido(req.body.reparto_german, req.body.reparto_ezequiel);
  const estado = ESTADOS_TRABAJO.includes(req.body.estado) ? req.body.estado : 'realizado';
  if (!nombre || !fecha || !rep) { req.session.flash = { tipo: 'error', msg: 'Datos del trabajo único inválidos.' }; return res.redirect('/clientes/' + cliente.id); }
  db.prepare(`
    INSERT INTO trabajos_unicos (cliente_id, nombre, monto, fecha, reparto_german, reparto_ezequiel, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cliente.id, nombre, monto, fecha, rep.rg, rep.re, estado);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Agregó trabajo único "${nombre}" (${monto}) — ${estado}`);
  req.session.flash = { tipo: 'ok', msg: estado === 'potencial' ? 'Trabajo potencial agregado.' : 'Trabajo único agregado.' };
  res.redirect('/clientes/' + cliente.id + '#unicos');
});

router.post('/:id/unicos/:tid', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  const t = db.prepare('SELECT * FROM trabajos_unicos WHERE id = ? AND cliente_id = ?').get(req.params.tid, req.params.id);
  if (!cliente || !t) return res.redirect('/clientes');

  if (req.body._accion === 'eliminar') {
    db.prepare('DELETE FROM trabajos_unicos WHERE id = ?').run(t.id);
    audit.registrar(req, 'clientes', cliente.id, 'editar', `Eliminó trabajo único "${t.nombre}"`);
    req.session.flash = { tipo: 'ok', msg: 'Trabajo único eliminado.' };
    return res.redirect('/clientes/' + cliente.id + '#unicos');
  }

  // Confirmar un trabajo potencial -> realizado (y reactivar al cliente si estaba inactivo/potencial).
  if (req.body._accion === 'confirmar' || req.body._accion === 'volver_potencial') {
    const nuevoEstado = req.body._accion === 'confirmar' ? 'realizado' : 'potencial';
    db.prepare('UPDATE trabajos_unicos SET estado = ? WHERE id = ?').run(nuevoEstado, t.id);
    let extra = '';
    if (nuevoEstado === 'realizado' && cliente.estado !== 'activo') {
      db.prepare("UPDATE clientes SET estado = 'activo' WHERE id = ?").run(cliente.id);
      extra = ' El cliente pasó a Activo.';
    }
    audit.registrar(req, 'clientes', cliente.id, 'editar',
      nuevoEstado === 'realizado' ? `Confirmó el trabajo "${t.nombre}".${extra}` : `Marcó "${t.nombre}" como potencial`);
    req.session.flash = { tipo: 'ok', msg: (nuevoEstado === 'realizado' ? 'Trabajo confirmado.' : 'Trabajo marcado como potencial.') + extra };
    return res.redirect('/clientes/' + cliente.id + '#unicos');
  }

  const nombre = String(req.body.nombre || '').trim() || t.nombre;
  const monto = req.body.monto != null ? Number(req.body.monto) : t.monto;
  const fecha = req.body.fecha ? String(req.body.fecha).slice(0, 10) : t.fecha;
  const rep = repartoValido(req.body.reparto_german, req.body.reparto_ezequiel) || { rg: t.reparto_german, re: t.reparto_ezequiel };
  const estado = ESTADOS_TRABAJO.includes(req.body.estado) ? req.body.estado : t.estado;
  db.prepare('UPDATE trabajos_unicos SET nombre=?, monto=?, fecha=?, reparto_german=?, reparto_ezequiel=?, estado=? WHERE id=?')
    .run(nombre, monto, fecha, rep.rg, rep.re, estado, t.id);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Editó trabajo único "${nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Trabajo único actualizado.' };
  res.redirect('/clientes/' + cliente.id + '#unicos');
});

module.exports = router;
