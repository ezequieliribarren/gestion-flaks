'use strict';

const express = require('express');
const db = require('../db');
const audit = require('../lib/audit');
const { revisar: revisarRemarketing } = require('../lib/remarketing');

const router = express.Router();

const RE_GOOGLE = /google ads|adwords|sem\b/i;
const RE_META = /meta ads|facebook ads|instagram ads/i;
const RE_REDES = /redes|community|contenido|social|instagram|posteo|reels|historias/i;

const SERVICIOS = ['redes', 'google', 'meta', 'web', 'otro'];
const RESULTADOS = ['ofrecido', 'esperando', 'presupuestado', 'interesado', 'rechazado', 'cerrado'];
const MAX_RECORDATORIOS = 3;

function etiquetaServicio(s) {
  return { redes: 'Redes / contenido', google: 'Google Ads', meta: 'Meta Ads', web: 'Página web', otro: 'Otro' }[s] || s;
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function diasDesde(fecha) {
  if (!fecha) return null;
  return Math.round((Date.now() - Date.parse(String(fecha).slice(0, 10) + 'T00:00:00')) / 86400000);
}

// Resumen en texto breve de los servicios que tuvo el cliente.
function resumenServicios(trabajos) {
  const t = String(trabajos || '').toLowerCase();
  const s = [];
  const add = (re, txt) => { if (re.test(t) && !s.includes(txt)) s.push(txt); };
  add(/landing/, 'landing page');
  add(/multip|multi.?p[aá]gina|institucional|wordpress|sitio|(^| )web( |$)/, 'sitio web');
  add(/tienda|ecommerce|e-commerce|tiendanube|tienda ?nube|mercado ?libre/, 'tienda online');
  add(RE_REDES, 'redes sociales');
  add(RE_GOOGLE, 'Google Ads');
  add(RE_META, 'Meta Ads');
  add(/mantenimiento|hosting/, 'mantenimiento');
  add(/blog/, 'blog');
  add(/dise[ñn]o|branding|logo|identidad/, 'diseño / branding');
  add(/automatiz|kommo|bot|whatsapp/, 'automatización');
  if (!s.length) return 'Sin servicios registrados.';
  return 'Se realizó ' + (s.length > 1 ? s.slice(0, -1).join(', ') + ' y ' + s[s.length - 1] : s[0]) + '.';
}

function accionesDe(cid) {
  return db.prepare('SELECT * FROM marketing_acciones WHERE cliente_id = ? ORDER BY fecha DESC, id DESC').all(cid);
}
function recordatoriosDe(cid) {
  return db.prepare('SELECT * FROM remarketing_recordatorios WHERE cliente_id = ? ORDER BY fecha').all(cid);
}

router.get('/', (req, res) => {
  revisarRemarketing();

  const sess = req.session.marketingVista || {};
  const modo = req.query.modo === 'lista' ? 'lista' : (req.query.modo === 'cards' ? 'cards' : (sess.modo === 'lista' ? 'lista' : 'cards'));
  req.session.marketingVista = { modo };

  const filas = db.prepare(`
    SELECT c.id, c.nombre, c.logo, c.estado, c.redes, c.marketing_excluido,
      c.contacto_nombre, c.contacto_telefono, c.contacto_email,
      (SELECT COUNT(*) FROM trabajos_recurrentes WHERE cliente_id = c.id AND activo = 1) AS rec_activos,
      (SELECT MAX(fecha) FROM trabajos_unicos WHERE cliente_id = c.id AND estado = 'realizado') AS ultimo_unico
    FROM clientes c
    ORDER BY c.nombre COLLATE NOCASE
  `).all();

  const excluidos = filas.filter((c) => c.marketing_excluido)
    .map((c) => ({ ...c, acciones: accionesDe(c.id) }));

  const items = new Map();
  function armar(c, esLead) {
    const trabajos = db.prepare(`
      SELECT nombre FROM trabajos_unicos WHERE cliente_id = ?
      UNION ALL SELECT nombre FROM trabajos_recurrentes WHERE cliente_id = ?
    `).all(c.id, c.id).map((t) => t.nombre).join(' | ');
    const acciones = accionesDe(c.id);
    const recordatorios = recordatoriosDe(c.id);
    const ult = acciones[0] || null;
    const proxRec = recordatorios.find((r) => diasDesde(r.fecha) <= 0) || null; // futuro más cercano
    const presupuestado = acciones.some((a) => a.resultado === 'presupuestado');
    return {
      ...c,
      esLead,
      resumen: resumenServicios(trabajos),
      dias_sin_servicio: c.ultimo_unico ? diasDesde(c.ultimo_unico) : null,
      acciones,
      recordatorios,
      prox_recordatorio: proxRec,
      ult_accion: ult,
      dias_ult_contacto: ult ? diasDesde(ult.fecha) : null,
      resultado_actual: ult ? ult.resultado : null,
      presupuestado,
      pendiente: acciones.some((a) => ['ofrecido', 'esperando', 'presupuestado', 'interesado'].includes(a.resultado)) || !!proxRec,
    };
  }

  for (const c of filas) {
    if (c.marketing_excluido) continue;
    const dsc = c.ultimo_unico ? diasDesde(c.ultimo_unico) : null;
    const esLead = c.rec_activos === 0 && (c.estado === 'inactivo' || c.estado === 'potencial' || dsc === null || dsc > 60);
    if (esLead) items.set(c.id, armar(c, true));
  }
  // clientes con seguimiento o recordatorios aunque ya no sean lead
  const conSeguimiento = db.prepare(`
    SELECT DISTINCT cliente_id FROM marketing_acciones
    UNION SELECT DISTINCT cliente_id FROM remarketing_recordatorios
  `).all().map((r) => r.cliente_id);
  for (const cid of conSeguimiento) {
    if (items.has(cid)) continue;
    const c = filas.find((x) => x.id === cid);
    if (c && !c.marketing_excluido) items.set(cid, armar(c, false));
  }

  const leads = [...items.values()].sort((a, b) => {
    if (a.pendiente !== b.pendiente) return a.pendiente ? -1 : 1;
    const da = a.dias_sin_servicio == null ? 1e9 : a.dias_sin_servicio;
    const dbb = b.dias_sin_servicio == null ? 1e9 : b.dias_sin_servicio;
    return dbb - da;
  });

  res.render('marketing/index', {
    titulo: 'Marketing', leads, excluidos, modo,
    SERVICIOS, RESULTADOS, MAX_RECORDATORIOS, etiquetaServicio, hoyISO: hoyISO(),
  });
});

// --- Alta de prospecto (todavía no está en Clientes) ---
router.post('/nuevo', (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  if (!nombre) { req.session.flash = { tipo: 'error', msg: 'Poné un nombre para el prospecto.' }; return res.redirect('/marketing'); }
  const info = db.prepare(`
    INSERT INTO clientes (nombre, estado, contacto_nombre, contacto_telefono, contacto_email, creado_por)
    VALUES (?, 'potencial', ?, ?, ?, ?)
  `).run(
    nombre,
    String(req.body.contacto_nombre || '').trim(),
    String(req.body.contacto_telefono || '').trim(),
    String(req.body.contacto_email || '').trim(),
    req.session.user.nombre
  );
  const cid = info.lastInsertRowid;
  audit.registrar(req, 'clientes', cid, 'crear', `Cargó el prospecto "${nombre}" desde Marketing`);

  // opcional: primera acción / presupuesto
  const detalle = String(req.body.detalle || '').trim();
  if (detalle || req.body.monto) {
    const servicio = SERVICIOS.includes(req.body.servicio) ? req.body.servicio : 'otro';
    const monto = Number(req.body.monto) || 0;
    const resultado = monto > 0 ? 'presupuestado' : 'ofrecido';
    db.prepare(`
      INSERT INTO marketing_acciones (cliente_id, servicio, detalle, monto, fecha, resultado, registrado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(cid, servicio, detalle, monto, hoyISO(), resultado, req.session.user.nombre);
  }
  req.session.flash = { tipo: 'ok', msg: `Prospecto "${nombre}" cargado.` };
  res.redirect('/marketing#c' + cid);
});

// --- Acciones (oferta / presupuesto / contacto) ---
router.post('/:cid/accion', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.cid);
  if (!cliente) return res.redirect('/marketing');
  const servicio = SERVICIOS.includes(req.body.servicio) ? req.body.servicio : 'otro';
  const resultado = RESULTADOS.includes(req.body.resultado) ? req.body.resultado : 'ofrecido';
  const fecha = req.body.fecha ? String(req.body.fecha).slice(0, 10) : hoyISO();
  const detalle = String(req.body.detalle || '').trim().slice(0, 500);
  const monto = Number(req.body.monto) || 0;

  db.prepare(`
    INSERT INTO marketing_acciones (cliente_id, servicio, detalle, monto, fecha, resultado, registrado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cliente.id, servicio, detalle, monto, fecha, resultado, req.session.user.nombre);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Marketing: ${resultado} "${etiquetaServicio(servicio)}"${monto ? ' $' + monto : ''} el ${fecha}`);
  req.session.flash = { tipo: 'ok', msg: 'Registrado.' };
  res.redirect('/marketing#c' + cliente.id);
});

router.post('/acciones/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM marketing_acciones WHERE id = ?').get(req.params.id);
  if (!a) return res.redirect('/marketing');
  if (req.body._accion === 'eliminar') {
    db.prepare('DELETE FROM marketing_acciones WHERE id = ?').run(a.id);
  } else if (RESULTADOS.includes(req.body.resultado)) {
    db.prepare('UPDATE marketing_acciones SET resultado = ? WHERE id = ?').run(req.body.resultado, a.id);
    audit.registrar(req, 'clientes', a.cliente_id, 'editar', `Marketing: "${etiquetaServicio(a.servicio)}" → ${req.body.resultado}`);
  }
  res.redirect('/marketing#c' + a.cliente_id);
});

// --- Recordatorios de re-marketing ---
router.post('/:cid/recordatorio', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.cid);
  if (!cliente) return res.redirect('/marketing');
  const n = db.prepare('SELECT COUNT(*) AS n FROM remarketing_recordatorios WHERE cliente_id = ?').get(cliente.id).n;
  if (n >= MAX_RECORDATORIOS) {
    req.session.flash = { tipo: 'error', msg: `Máximo ${MAX_RECORDATORIOS} fechas de re-marketing por cliente.` };
    return res.redirect('/marketing#c' + cliente.id);
  }
  const fecha = req.body.fecha ? String(req.body.fecha).slice(0, 10) : null;
  if (!fecha) { req.session.flash = { tipo: 'error', msg: 'Elegí una fecha.' }; return res.redirect('/marketing#c' + cliente.id); }
  db.prepare('INSERT INTO remarketing_recordatorios (cliente_id, fecha, nota, creado_por) VALUES (?, ?, ?, ?)')
    .run(cliente.id, fecha, String(req.body.nota || '').trim().slice(0, 300), req.session.user.nombre);
  revisarRemarketing();
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Marketing: recordatorio de re-marketing para el ${fecha}`);
  req.session.flash = { tipo: 'ok', msg: 'Recordatorio agregado.' };
  res.redirect('/marketing#c' + cliente.id);
});

router.post('/recordatorios/:id/eliminar', (req, res) => {
  const r = db.prepare('SELECT * FROM remarketing_recordatorios WHERE id = ?').get(req.params.id);
  if (!r) return res.redirect('/marketing');
  db.prepare('DELETE FROM remarketing_recordatorios WHERE id = ?').run(r.id);
  res.redirect('/marketing#c' + r.cliente_id);
});

// --- Convertir en cliente / descartar ---
router.post('/:cid/convertir', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.cid);
  if (!cliente) return res.redirect('/marketing');
  db.prepare("UPDATE clientes SET estado = 'activo', marketing_excluido = 0 WHERE id = ?").run(cliente.id);
  db.prepare('DELETE FROM remarketing_recordatorios WHERE cliente_id = ?').run(cliente.id);
  const ult = db.prepare("SELECT id FROM marketing_acciones WHERE cliente_id = ? ORDER BY fecha DESC, id DESC LIMIT 1").get(cliente.id);
  if (ult) db.prepare("UPDATE marketing_acciones SET resultado = 'cerrado' WHERE id = ?").run(ult.id);
  audit.registrar(req, 'clientes', cliente.id, 'editar', 'Marketing: aceptó — pasó a cliente activo');
  req.session.flash = { tipo: 'ok', msg: `"${cliente.nombre}" ahora es cliente activo. Cargale el trabajo acá.` };
  res.redirect('/clientes/' + cliente.id);
});

router.post('/:cid/excluir', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.cid);
  if (!cliente) return res.redirect('/marketing');
  const incluir = req.body._accion === 'incluir';
  db.prepare('UPDATE clientes SET marketing_excluido = ? WHERE id = ?').run(incluir ? 0 : 1, cliente.id);
  audit.registrar(req, 'clientes', cliente.id, 'editar', incluir ? 'Volvió a incluir en Marketing' : 'Sacó de Marketing (no ofrecer más)');
  req.session.flash = { tipo: 'ok', msg: incluir ? `"${cliente.nombre}" vuelve a Marketing.` : `"${cliente.nombre}" no aparece más en Marketing.` };
  res.redirect('/marketing');
});

module.exports = router;
