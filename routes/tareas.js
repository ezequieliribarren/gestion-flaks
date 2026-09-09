'use strict';

const express = require('express');
const db = require('../db');
const audit = require('../lib/audit');
const fmt = require('../lib/format');
const { usuarios, asignadosDe, asignadosIds, setAsignados, notificarParticipantes } = require('../lib/participacion');

const router = express.Router();

const PRIORIDADES = ['baja', 'media', 'alta'];
const ESTADOS = ['pendiente', 'en_progreso', 'completada'];

function conVencimiento(t) {
  const v = fmt.estadoVencimiento(t.fecha_cierre, t.estado === 'completada');
  return { ...t, vencida: v.vencida, dias_vencida: v.dias, vence_hoy: v.venceHoy, texto_vencida: fmt.textoVencida(v) };
}

router.get('/', (req, res) => {
  const sess = req.session.tareasVista || {};
  const vista = ['hoy', 'mes', 'todas'].includes(req.query.vista) ? req.query.vista
    : (['hoy', 'mes', 'todas'].includes(sess.vista) ? sess.vista : 'hoy');
  const modo = req.query.modo === 'lista' ? 'lista'
    : (req.query.modo === 'cards' ? 'cards' : (sess.modo === 'lista' ? 'lista' : 'cards'));
  req.session.tareasVista = { vista, modo };

  const fCliente = req.query.cliente || null; // id | 'interna' | 'sin'
  const fPrioridad = PRIORIDADES.includes(req.query.prioridad) ? req.query.prioridad : null;
  const fEstado = ESTADOS.includes(req.query.estado) ? req.query.estado : null;
  const fAsignado = req.query.asignado ? Number(req.query.asignado) : null;

  const hoy = fmt.ahora().iso;
  const mesPrefijo = hoy.slice(0, 7);
  const where = [];
  const params = [];

  if (vista === 'hoy') {
    // vence hoy, o vencida sin completar (no importa hace cuánto)
    where.push("(substr(t.fecha_cierre,1,10) = ? OR (t.fecha_cierre IS NOT NULL AND substr(t.fecha_cierre,1,10) < ? AND t.estado <> 'completada'))");
    params.push(hoy, hoy);
  } else if (vista === 'mes') {
    where.push('t.fecha_cierre IS NOT NULL AND substr(t.fecha_cierre,1,7) = ?');
    params.push(mesPrefijo);
  }
  if (fCliente === 'interna') where.push('t.interna = 1');
  else if (fCliente === 'sin') where.push('t.cliente_id IS NULL AND t.interna = 0');
  else if (fCliente && !isNaN(Number(fCliente))) { where.push('t.cliente_id = ?'); params.push(Number(fCliente)); }
  if (fPrioridad) { where.push('t.prioridad = ?'); params.push(fPrioridad); }
  if (fEstado) { where.push('t.estado = ?'); params.push(fEstado); }
  if (fAsignado) { where.push('EXISTS (SELECT 1 FROM asignaciones a WHERE a.tipo = \'tarea\' AND a.ref_id = t.id AND a.user_id = ?)'); params.push(fAsignado); }

  const sql = `
    SELECT t.*, c.nombre AS cliente_nombre, c.logo AS cliente_logo,
      (SELECT COUNT(*) FROM tarea_partes WHERE tarea_id = t.id) AS partes_total,
      (SELECT COUNT(*) FROM tarea_partes WHERE tarea_id = t.id AND hecho = 1) AS partes_hechas
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
    ...conVencimiento(t),
    asignados: asignadosDe('tarea', t.id),
  }));

  const clientes = db.prepare('SELECT id, nombre FROM clientes ORDER BY nombre').all();

  res.render('tareas/index', {
    titulo: 'Tareas',
    tareas,
    clientes,
    users: usuarios(),
    vista,
    modo,
    filtros: { cliente: fCliente, prioridad: fPrioridad, estado: fEstado, asignado: fAsignado },
    PRIORIDADES,
    ESTADOS,
  });
});

function formData(req) {
  const clientes = db.prepare('SELECT id, nombre FROM clientes ORDER BY nombre').all();
  return { clientes, users: usuarios(), PRIORIDADES, ESTADOS };
}

router.get('/nueva', (req, res) => {
  res.render('tareas/form', { titulo: 'Nueva tarea', tarea: {}, asignadosSel: [], ...formData(req) });
});

router.get('/:id', (req, res) => {
  const tarea = db.prepare(`
    SELECT t.*, c.nombre AS cliente_nombre, c.logo AS cliente_logo
    FROM tareas t LEFT JOIN clientes c ON c.id = t.cliente_id WHERE t.id = ?
  `).get(req.params.id);
  if (!tarea) return res.status(404).render('error', { titulo: 'No encontrada', mensaje: 'La tarea no existe.' });

  const partes = db.prepare('SELECT * FROM tarea_partes WHERE tarea_id = ? ORDER BY orden, id').all(tarea.id);
  res.render('tareas/detalle', {
    titulo: tarea.nombre,
    tarea: conVencimiento(tarea),
    partes,
    asignados: asignadosDe('tarea', tarea.id),
    asignadosSel: asignadosIds('tarea', tarea.id),
    historial: audit.historial('tareas', tarea.id),
    ...formData(req),
  });
});

function leerDatos(body) {
  const nombre = String(body.nombre || '').trim();
  const descripcion = String(body.descripcion || '').trim();
  const links = String(body.links || '').trim();
  const prioridad = PRIORIDADES.includes(body.prioridad) ? body.prioridad : 'media';
  const estado = ESTADOS.includes(body.estado) ? body.estado : 'pendiente';
  const fecha_cierre = body.fecha_cierre ? String(body.fecha_cierre).slice(0, 10) : null;
  const interna = body.cliente_id === 'interna' ? 1 : 0;
  const cliente_id = (interna || !body.cliente_id || body.cliente_id === 'sin') ? null : Number(body.cliente_id);
  let asignados = body.asignados || [];
  if (!Array.isArray(asignados)) asignados = [asignados];
  return { nombre, descripcion, links, prioridad, estado, fecha_cierre, interna, cliente_id, asignados };
}

router.post('/', (req, res) => {
  const d = leerDatos(req.body);
  if (!d.nombre) { req.session.flash = { tipo: 'error', msg: 'El nombre es obligatorio.' }; return res.redirect('/tareas/nueva'); }

  const info = db.prepare(`
    INSERT INTO tareas (nombre, descripcion, links, prioridad, estado, fecha_cierre, cliente_id, interna, creado_por, ultima_modificacion_por, ultima_modificacion_en)
    VALUES (@nombre, @descripcion, @links, @prioridad, @estado, @fecha_cierre, @cliente_id, @interna, @usuario, @usuario, datetime('now'))
  `).run({ ...d, usuario: req.session.user.nombre });
  const tid = info.lastInsertRowid;
  setAsignados('tarea', tid, d.asignados);
  audit.registrar(req, 'tareas', tid, 'crear', `Creó la tarea "${d.nombre}"`);
  notificarParticipantes('tarea', tid, req.session.user.nombre, req.session.user, {
    texto: `${req.session.user.nombre} te asignó la tarea "${d.nombre}"`,
    url: '/tareas/' + tid,
  });
  req.session.flash = { tipo: 'ok', msg: 'Tarea creada.' };
  res.redirect('/tareas/' + tid);
});

router.post('/:id', (req, res) => {
  const tarea = db.prepare('SELECT * FROM tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.status(404).render('error', { titulo: 'No encontrada', mensaje: 'La tarea no existe.' });
  const d = leerDatos(req.body);
  if (!d.nombre) { req.session.flash = { tipo: 'error', msg: 'El nombre es obligatorio.' }; return res.redirect('/tareas/' + tarea.id); }

  db.prepare(`
    UPDATE tareas SET nombre=@nombre, descripcion=@descripcion, links=@links, prioridad=@prioridad, estado=@estado,
      fecha_cierre=@fecha_cierre, cliente_id=@cliente_id, interna=@interna
    WHERE id=@id
  `).run({ ...d, id: tarea.id });
  setAsignados('tarea', tarea.id, d.asignados);
  audit.tocarTarea(req, tarea.id);
  audit.registrar(req, 'tareas', tarea.id, 'editar', `Editó la tarea "${d.nombre}"`);
  notificarParticipantes('tarea', tarea.id, tarea.creado_por, req.session.user, {
    texto: `${req.session.user.nombre} modificó la tarea "${d.nombre}"`,
    url: '/tareas/' + tarea.id,
  });
  req.session.flash = { tipo: 'ok', msg: 'Tarea actualizada.' };
  res.redirect(req.body.volver_a || ('/tareas/' + tarea.id));
});

router.post('/:id/estado', (req, res) => {
  const tarea = db.prepare('SELECT * FROM tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.redirect('/tareas');
  const nuevo = ESTADOS.includes(req.body.estado) ? req.body.estado : 'completada';
  db.prepare('UPDATE tareas SET estado = ? WHERE id = ?').run(nuevo, tarea.id);
  audit.tocarTarea(req, tarea.id);
  audit.registrar(req, 'tareas', tarea.id, 'editar', `Cambió el estado a "${nuevo}"`);
  notificarParticipantes('tarea', tarea.id, tarea.creado_por, req.session.user, {
    texto: `${req.session.user.nombre} marcó "${tarea.nombre}" como ${nuevo.replace('_', ' ')}`,
    url: '/tareas/' + tarea.id,
  });
  req.session.flash = { tipo: 'ok', msg: 'Estado actualizado.' };
  res.redirect(req.get('referer') || '/tareas');
});

router.post('/:id/eliminar', (req, res) => {
  const tarea = db.prepare('SELECT * FROM tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.redirect('/tareas');
  db.prepare('DELETE FROM asignaciones WHERE tipo = \'tarea\' AND ref_id = ?').run(tarea.id);
  db.prepare('DELETE FROM tareas WHERE id = ?').run(tarea.id);
  audit.registrar(req, 'tareas', tarea.id, 'eliminar', `Eliminó la tarea "${tarea.nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Tarea eliminada.' };
  res.redirect('/tareas');
});

// --- Partes ---
router.post('/:id/partes', (req, res) => {
  const tarea = db.prepare('SELECT * FROM tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.redirect('/tareas');
  const textos = String(req.body.texto || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const maxOrden = db.prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM tarea_partes WHERE tarea_id = ?').get(tarea.id).m;
  const ins = db.prepare('INSERT INTO tarea_partes (tarea_id, texto, orden) VALUES (?, ?, ?)');
  textos.forEach((txt, i) => ins.run(tarea.id, txt, maxOrden + i + 1));
  if (textos.length) {
    audit.tocarTarea(req, tarea.id);
    audit.registrar(req, 'tareas', tarea.id, 'editar', `Agregó ${textos.length} parte(s)`);
  }
  res.redirect('/tareas/' + tarea.id + '#partes');
});

router.post('/:id/partes/:pid', (req, res) => {
  const parte = db.prepare('SELECT * FROM tarea_partes WHERE id = ? AND tarea_id = ?').get(req.params.pid, req.params.id);
  if (!parte) return res.redirect('/tareas/' + req.params.id + '#partes');
  if (req.body._accion === 'eliminar') {
    db.prepare('DELETE FROM tarea_partes WHERE id = ?').run(parte.id);
  } else if (req.body._accion === 'texto') {
    const txt = String(req.body.texto || '').trim();
    if (txt) db.prepare('UPDATE tarea_partes SET texto = ? WHERE id = ?').run(txt, parte.id);
  } else {
    db.prepare('UPDATE tarea_partes SET hecho = ? WHERE id = ?').run(parte.hecho ? 0 : 1, parte.id);
  }
  audit.tocarTarea(req, req.params.id);
  res.redirect('/tareas/' + req.params.id + '#partes');
});

module.exports = router;
