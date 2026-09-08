'use strict';

const express = require('express');
const db = require('../db');
const audit = require('../lib/audit');
const { esAdmin } = require('../middleware/auth');
const { TIPOS, ESTADOS_TAREA, normalizarUrl, usoPrevio } = require('../lib/contenido');

const router = express.Router();

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function soloAdminAccion(req, res) {
  if (esAdmin(req.session.user)) return true;
  req.session.flash = { tipo: 'error', msg: 'Esta acción es solo para administradores.' };
  res.redirect(req.get('referer') || '/contenido');
  return false;
}

function tocarTarea(req, id) {
  db.prepare("UPDATE tareas_contenido SET ultima_modificacion_por = ?, ultima_modificacion_en = datetime('now') WHERE id = ?")
    .run(req.session.user.nombre, id);
}

// --- Lista de clientes de contenido ---
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const where = ['c.redes = 1'];
  const params = [];
  if (q) { where.push('LOWER(c.nombre) LIKE LOWER(?)'); params.push('%' + q + '%'); }

  const clientes = db.prepare(`
    SELECT c.id, c.nombre, c.logo, c.redes_plan, c.redes_sheet_url,
      (SELECT COUNT(*) FROM tareas_contenido WHERE cliente_id = c.id AND estado <> 'completada') AS tareas_abiertas,
      (SELECT COUNT(*) FROM tareas_contenido WHERE cliente_id = c.id) AS tareas_total
    FROM clientes c
    WHERE ${where.join(' AND ')}
    ORDER BY c.nombre COLLATE NOCASE
  `).all(...params);

  let disponibles = [];
  if (esAdmin(req.session.user)) {
    disponibles = db.prepare("SELECT id, nombre FROM clientes WHERE redes = 0 ORDER BY nombre COLLATE NOCASE").all();
  }

  res.render('contenido/index', { titulo: 'Contenido', clientes, disponibles, q });
});

// Agregar un cliente existente al módulo de contenido (admin).
router.post('/agregar', (req, res) => {
  if (!soloAdminAccion(req, res)) return;
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.body.cliente_id);
  if (!cliente) { req.session.flash = { tipo: 'error', msg: 'Cliente inexistente.' }; return res.redirect('/contenido'); }
  db.prepare('UPDATE clientes SET redes = 1 WHERE id = ?').run(cliente.id);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Agregó "${cliente.nombre}" al módulo de contenido`);
  req.session.flash = { tipo: 'ok', msg: `"${cliente.nombre}" agregado a Contenido.` };
  res.redirect('/contenido/' + cliente.id);
});

// --- Detalle de un cliente de contenido ---
router.get('/:id', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ? AND redes = 1').get(req.params.id);
  if (!cliente) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Este cliente no está en el módulo de contenido.' });

  const tareas = db.prepare(`
    SELECT tc.*,
      (SELECT COUNT(*) FROM contenido_links WHERE tarea_id = tc.id) AS links_total,
      (SELECT COUNT(*) FROM contenido_links WHERE tarea_id = tc.id AND realizado = 1) AS links_hechos
    FROM tareas_contenido tc
    WHERE tc.cliente_id = ?
    ORDER BY CASE tc.estado WHEN 'completada' THEN 1 ELSE 0 END, tc.creado_en DESC
  `).all(cliente.id);

  res.render('contenido/cliente', { titulo: cliente.nombre + ' · Contenido', cliente, tareas, TIPOS, hoyISO: hoyISO() });
});

// Configurar plan / sheet / quitar (admin).
router.post('/:id/config', (req, res) => {
  if (!soloAdminAccion(req, res)) return;
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/contenido');

  if (req.body._accion === 'quitar') {
    db.prepare('UPDATE clientes SET redes = 0 WHERE id = ?').run(cliente.id);
    audit.registrar(req, 'clientes', cliente.id, 'editar', `Quitó "${cliente.nombre}" del módulo de contenido`);
    req.session.flash = { tipo: 'ok', msg: `"${cliente.nombre}" quitado de Contenido.` };
    return res.redirect('/contenido');
  }

  const plan = String(req.body.redes_plan || '').trim() || null;
  const sheet = String(req.body.redes_sheet_url || '').trim() || null;
  db.prepare('UPDATE clientes SET redes_plan = ?, redes_sheet_url = ? WHERE id = ?').run(plan, sheet, cliente.id);
  audit.registrar(req, 'clientes', cliente.id, 'editar', 'Actualizó el plan / sheet de contenido');
  req.session.flash = { tipo: 'ok', msg: 'Datos de contenido guardados.' };
  res.redirect('/contenido/' + cliente.id);
});

// --- Tareas de contenido ---
router.post('/:id/tareas', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ? AND redes = 1').get(req.params.id);
  if (!cliente) return res.redirect('/contenido');
  const titulo = String(req.body.titulo || '').trim();
  const tipo = TIPOS.includes(req.body.tipo) ? req.body.tipo : 'historias';
  const fecha = req.body.fecha_objetivo ? String(req.body.fecha_objetivo).slice(0, 10) : null;
  if (!titulo) { req.session.flash = { tipo: 'error', msg: 'Poné un título para la tarea de contenido.' }; return res.redirect('/contenido/' + cliente.id); }

  const info = db.prepare(`
    INSERT INTO tareas_contenido (cliente_id, tipo, titulo, fecha_objetivo, creado_por, ultima_modificacion_por, ultima_modificacion_en)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(cliente.id, tipo, titulo, fecha, req.session.user.nombre, req.session.user.nombre);
  audit.registrar(req, 'contenido', info.lastInsertRowid, 'crear', `Creó tarea de contenido "${titulo}" (${tipo}) para ${cliente.nombre}`);
  req.session.flash = { tipo: 'ok', msg: 'Tarea de contenido creada.' };
  res.redirect('/contenido/' + cliente.id + '/tareas/' + info.lastInsertRowid);
});

router.get('/:id/tareas/:tid', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ? AND redes = 1').get(req.params.id);
  const tarea = db.prepare('SELECT * FROM tareas_contenido WHERE id = ? AND cliente_id = ?').get(req.params.tid, req.params.id);
  if (!cliente || !tarea) return res.status(404).render('error', { titulo: 'No encontrada', mensaje: 'La tarea de contenido no existe.' });

  const links = db.prepare('SELECT * FROM contenido_links WHERE tarea_id = ? ORDER BY id').all(tarea.id).map((l) => ({
    ...l,
    uso_previo: usoPrevio(l.url_norm, l.id),
  }));

  res.render('contenido/tarea', {
    titulo: tarea.titulo,
    cliente,
    tarea,
    links,
    TIPOS,
    ESTADOS_TAREA,
    historial: audit.historial('contenido', tarea.id),
  });
});

router.post('/:id/tareas/:tid', (req, res) => {
  const tarea = db.prepare('SELECT * FROM tareas_contenido WHERE id = ? AND cliente_id = ?').get(req.params.tid, req.params.id);
  if (!tarea) return res.redirect('/contenido/' + req.params.id);
  const titulo = String(req.body.titulo || '').trim() || tarea.titulo;
  const tipo = TIPOS.includes(req.body.tipo) ? req.body.tipo : tarea.tipo;
  const estado = ESTADOS_TAREA.includes(req.body.estado) ? req.body.estado : tarea.estado;
  const descripcion = String(req.body.descripcion || '').trim();
  const fecha = req.body.fecha_objetivo ? String(req.body.fecha_objetivo).slice(0, 10) : null;
  db.prepare('UPDATE tareas_contenido SET titulo=?, tipo=?, estado=?, descripcion=?, fecha_objetivo=? WHERE id=?')
    .run(titulo, tipo, estado, descripcion, fecha, tarea.id);
  tocarTarea(req, tarea.id);
  audit.registrar(req, 'contenido', tarea.id, 'editar', `Editó la tarea de contenido "${titulo}"`);
  req.session.flash = { tipo: 'ok', msg: 'Tarea actualizada.' };
  res.redirect('/contenido/' + req.params.id + '/tareas/' + tarea.id);
});

router.post('/:id/tareas/:tid/eliminar', (req, res) => {
  const tarea = db.prepare('SELECT * FROM tareas_contenido WHERE id = ? AND cliente_id = ?').get(req.params.tid, req.params.id);
  if (!tarea) return res.redirect('/contenido/' + req.params.id);
  db.prepare('DELETE FROM tareas_contenido WHERE id = ?').run(tarea.id);
  audit.registrar(req, 'contenido', tarea.id, 'eliminar', `Eliminó la tarea de contenido "${tarea.titulo}"`);
  req.session.flash = { tipo: 'ok', msg: 'Tarea de contenido eliminada.' };
  res.redirect('/contenido/' + req.params.id);
});

// --- Links de una tarea ---
router.post('/:id/tareas/:tid/links', (req, res) => {
  const tarea = db.prepare('SELECT * FROM tareas_contenido WHERE id = ? AND cliente_id = ?').get(req.params.tid, req.params.id);
  if (!tarea) return res.redirect('/contenido/' + req.params.id);

  const crudos = String(req.body.links || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const ins = db.prepare(`
    INSERT INTO contenido_links (tarea_id, cliente_id, url, url_norm, creado_por)
    VALUES (?, ?, ?, ?, ?)
  `);
  const existentes = new Set(
    db.prepare('SELECT url_norm FROM contenido_links WHERE tarea_id = ?').all(tarea.id).map((r) => r.url_norm)
  );
  let agregados = 0;
  let repetidosEnTarea = 0;
  for (const url of crudos) {
    const norm = normalizarUrl(url);
    if (!norm) continue;
    if (existentes.has(norm)) { repetidosEnTarea++; continue; }
    existentes.add(norm);
    ins.run(tarea.id, tarea.cliente_id, url, norm, req.session.user.nombre);
    agregados++;
  }
  tocarTarea(req, tarea.id);
  if (agregados) audit.registrar(req, 'contenido', tarea.id, 'editar', `Agregó ${agregados} link(s)`);
  const partes = [];
  if (agregados) partes.push(`${agregados} link(s) agregado(s)`);
  if (repetidosEnTarea) partes.push(`${repetidosEnTarea} ya estaban en la lista`);
  req.session.flash = { tipo: agregados ? 'ok' : 'error', msg: partes.join(' · ') || 'No se agregó ningún link.' };
  res.redirect('/contenido/' + req.params.id + '/tareas/' + tarea.id);
});

router.post('/:id/tareas/:tid/links/:lid/realizado', (req, res) => {
  const link = db.prepare('SELECT * FROM contenido_links WHERE id = ? AND tarea_id = ?').get(req.params.lid, req.params.tid);
  if (!link) return res.redirect('/contenido/' + req.params.id + '/tareas/' + req.params.tid);
  const valor = link.realizado ? 0 : 1;
  db.prepare('UPDATE contenido_links SET realizado = ?, realizado_en = ? WHERE id = ?')
    .run(valor, valor ? hoyISO() : null, link.id);
  tocarTarea(req, link.tarea_id);
  audit.registrar(req, 'contenido', link.tarea_id, 'editar', valor ? `Marcó un link como usado/realizado` : 'Desmarcó un link');
  res.redirect('/contenido/' + req.params.id + '/tareas/' + req.params.tid);
});

router.post('/:id/tareas/:tid/links/:lid/eliminar', (req, res) => {
  const link = db.prepare('SELECT * FROM contenido_links WHERE id = ? AND tarea_id = ?').get(req.params.lid, req.params.tid);
  if (!link) return res.redirect('/contenido/' + req.params.id + '/tareas/' + req.params.tid);
  db.prepare('DELETE FROM contenido_links WHERE id = ?').run(link.id);
  tocarTarea(req, link.tarea_id);
  audit.registrar(req, 'contenido', link.tarea_id, 'editar', 'Eliminó un link');
  req.session.flash = { tipo: 'ok', msg: 'Link eliminado.' };
  res.redirect('/contenido/' + req.params.id + '/tareas/' + req.params.tid);
});

module.exports = router;
