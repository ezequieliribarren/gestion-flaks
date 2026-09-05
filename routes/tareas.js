'use strict';

const express = require('express');
const db = require('../db');
const audit = require('../lib/audit');

const router = express.Router();

const PRIORIDADES = ['baja', 'media', 'alta'];
const ESTADOS = ['pendiente', 'en_progreso', 'completada'];

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

router.get('/', (req, res) => {
  const vista = ['hoy', 'mes', 'todas'].includes(req.query.vista) ? req.query.vista : 'hoy';
  const fCliente = req.query.cliente ? Number(req.query.cliente) : null;
  const fPrioridad = PRIORIDADES.includes(req.query.prioridad) ? req.query.prioridad : null;
  const fEstado = ESTADOS.includes(req.query.estado) ? req.query.estado : null;

  const where = [];
  const params = [];

  const hoy = hoyISO();
  const mesPrefijo = hoy.slice(0, 7);
  if (vista === 'hoy') {
    where.push('t.fecha_cierre IS NOT NULL AND substr(t.fecha_cierre,1,10) = ?');
    params.push(hoy);
  } else if (vista === 'mes') {
    where.push('t.fecha_cierre IS NOT NULL AND substr(t.fecha_cierre,1,7) = ?');
    params.push(mesPrefijo);
  }
  if (fCliente) { where.push('t.cliente_id = ?'); params.push(fCliente); }
  if (fPrioridad) { where.push('t.prioridad = ?'); params.push(fPrioridad); }
  if (fEstado) { where.push('t.estado = ?'); params.push(fEstado); }

  const sql = `
    SELECT t.*, c.nombre AS cliente_nombre, c.logo AS cliente_logo
    FROM tareas t
    LEFT JOIN clientes c ON c.id = t.cliente_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY
      CASE t.estado WHEN 'completada' THEN 1 ELSE 0 END,
      (t.fecha_cierre IS NULL),
      t.fecha_cierre ASC,
      CASE t.prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END
  `;
  const tareas = db.prepare(sql).all(...params).map((t) => ({
    ...t,
    ultima: audit.ultimaModificacion('tareas', t.id),
    vencida: t.fecha_cierre && t.estado !== 'completada' && t.fecha_cierre.slice(0, 10) < hoy,
  }));

  const clientes = db.prepare('SELECT id, nombre FROM clientes ORDER BY nombre').all();

  res.render('tareas/index', {
    titulo: 'Tareas',
    tareas,
    clientes,
    vista,
    filtros: { cliente: fCliente, prioridad: fPrioridad, estado: fEstado },
    PRIORIDADES,
    ESTADOS,
  });
});

router.get('/nueva', (req, res) => {
  const clientes = db.prepare('SELECT id, nombre FROM clientes ORDER BY nombre').all();
  res.render('tareas/form', { titulo: 'Nueva tarea', tarea: {}, clientes, PRIORIDADES, ESTADOS });
});

router.get('/:id', (req, res) => {
  const tarea = db.prepare(`
    SELECT t.*, c.nombre AS cliente_nombre, c.logo AS cliente_logo
    FROM tareas t LEFT JOIN clientes c ON c.id = t.cliente_id
    WHERE t.id = ?
  `).get(req.params.id);
  if (!tarea) return res.status(404).render('error', { titulo: 'No encontrada', mensaje: 'La tarea no existe.' });
  const clientes = db.prepare('SELECT id, nombre FROM clientes ORDER BY nombre').all();
  res.render('tareas/detalle', {
    titulo: tarea.nombre,
    tarea,
    clientes,
    PRIORIDADES,
    ESTADOS,
    historial: audit.historial('tareas', tarea.id),
  });
});

function leerDatos(body) {
  const nombre = String(body.nombre || '').trim();
  const descripcion = String(body.descripcion || '').trim();
  const prioridad = PRIORIDADES.includes(body.prioridad) ? body.prioridad : 'media';
  const estado = ESTADOS.includes(body.estado) ? body.estado : 'pendiente';
  const fecha_cierre = body.fecha_cierre ? String(body.fecha_cierre).slice(0, 10) : null;
  const cliente_id = body.cliente_id ? Number(body.cliente_id) : null;
  return { nombre, descripcion, prioridad, estado, fecha_cierre, cliente_id };
}

router.post('/', (req, res) => {
  const d = leerDatos(req.body);
  if (!d.nombre) { req.session.flash = { tipo: 'error', msg: 'El nombre es obligatorio.' }; return res.redirect('/tareas/nueva'); }

  const info = db.prepare(`
    INSERT INTO tareas (nombre, descripcion, prioridad, estado, fecha_cierre, cliente_id, creado_por, ultima_modificacion_por, ultima_modificacion_en)
    VALUES (@nombre, @descripcion, @prioridad, @estado, @fecha_cierre, @cliente_id, @usuario, @usuario, datetime('now'))
  `).run({ ...d, usuario: req.session.user.nombre });

  audit.registrar(req, 'tareas', info.lastInsertRowid, 'crear', `Creó la tarea "${d.nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Tarea creada.' };
  res.redirect('/tareas');
});

router.post('/:id', (req, res) => {
  const tarea = db.prepare('SELECT * FROM tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.status(404).render('error', { titulo: 'No encontrada', mensaje: 'La tarea no existe.' });
  const d = leerDatos(req.body);
  if (!d.nombre) { req.session.flash = { tipo: 'error', msg: 'El nombre es obligatorio.' }; return res.redirect('/tareas/' + tarea.id); }

  db.prepare(`
    UPDATE tareas SET nombre=@nombre, descripcion=@descripcion, prioridad=@prioridad, estado=@estado,
      fecha_cierre=@fecha_cierre, cliente_id=@cliente_id
    WHERE id=@id
  `).run({ ...d, id: tarea.id });
  audit.tocarTarea(req, tarea.id);
  audit.registrar(req, 'tareas', tarea.id, 'editar', `Editó la tarea "${d.nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Tarea actualizada.' };
  res.redirect(req.body.volver_a || ('/tareas/' + tarea.id));
});

router.post('/:id/estado', (req, res) => {
  const tarea = db.prepare('SELECT * FROM tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.status(404).json({ ok: false });
  const nuevo = ESTADOS.includes(req.body.estado) ? req.body.estado : 'completada';
  db.prepare('UPDATE tareas SET estado = ? WHERE id = ?').run(nuevo, tarea.id);
  audit.tocarTarea(req, tarea.id);
  audit.registrar(req, 'tareas', tarea.id, 'editar', `Cambió el estado a "${nuevo}"`);
  req.session.flash = { tipo: 'ok', msg: 'Estado actualizado.' };
  res.redirect(req.get('referer') || '/tareas');
});

router.post('/:id/eliminar', (req, res) => {
  const tarea = db.prepare('SELECT * FROM tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.redirect('/tareas');
  db.prepare('DELETE FROM tareas WHERE id = ?').run(tarea.id);
  audit.registrar(req, 'tareas', tarea.id, 'eliminar', `Eliminó la tarea "${tarea.nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Tarea eliminada.' };
  res.redirect('/tareas');
});

module.exports = router;
