'use strict';

const express = require('express');
const db = require('../db');
const audit = require('../lib/audit');

const router = express.Router();

const RE_WEB = /web|landing|wordpress|tienda|sitio|multip[aá]gina|p[aá]gina|ecommerce|e-commerce|institucional|catalogo|catálogo/i;
const RE_GOOGLE = /google ads|adwords|google adwords|sem\b/i;
const RE_META = /meta ads|facebook ads|instagram ads|meta\b|fb ads/i;
const RE_REDES = /redes|community|contenido|social|instagram|posteo|reels|historias/i;

const SERVICIOS = ['redes', 'google', 'meta', 'web', 'otro'];
const RESULTADOS = ['ofrecido', 'esperando', 'interesado', 'rechazado', 'cerrado'];

function etiquetaServicio(s) {
  return { redes: 'Redes / contenido', google: 'Google Ads', meta: 'Meta Ads', web: 'Página web', otro: 'Otro' }[s] || s;
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function accionesDe(clienteId) {
  return db.prepare('SELECT * FROM marketing_acciones WHERE cliente_id = ? ORDER BY fecha DESC, id DESC').all(clienteId);
}
function diasDesde(fecha) {
  if (!fecha) return null;
  return Math.round((Date.now() - Date.parse(String(fecha).slice(0, 10) + 'T00:00:00')) / 86400000);
}

router.get('/', (req, res) => {
  const filas = db.prepare(`
    SELECT c.id, c.nombre, c.logo, c.estado, c.redes,
      (SELECT COUNT(*) FROM trabajos_recurrentes WHERE cliente_id = c.id AND activo = 1) AS rec_activos,
      (SELECT MAX(fecha) FROM trabajos_unicos WHERE cliente_id = c.id AND estado = 'realizado') AS ultimo_unico
    FROM clientes c
    ORDER BY c.nombre COLLATE NOCASE
  `).all();

  const items = new Map();

  function armar(c, esLead) {
    const trabajos = db.prepare(`
      SELECT nombre FROM trabajos_unicos WHERE cliente_id = ?
      UNION ALL SELECT nombre FROM trabajos_recurrentes WHERE cliente_id = ?
    `).all(c.id, c.id).map((t) => t.nombre).join(' | ');
    const hizo = {
      web: RE_WEB.test(trabajos),
      google: RE_GOOGLE.test(trabajos),
      meta: RE_META.test(trabajos),
      redes: c.redes === 1 || RE_REDES.test(trabajos),
    };
    const acciones = accionesDe(c.id);
    // no volver a sugerir un servicio ya ofrecido y sin cerrar como "rechazado"
    const ofrecidos = new Set(acciones.filter((a) => a.resultado !== 'rechazado').map((a) => a.servicio));
    const sugerencias = [];
    if (!hizo.redes && !ofrecidos.has('redes')) sugerencias.push({ k: 'redes', txt: 'Gestión de redes / contenido' });
    if (!hizo.google && !ofrecidos.has('google')) sugerencias.push({ k: 'google', txt: 'Publicidad en Google Ads' });
    if (!hizo.meta && !ofrecidos.has('meta')) sugerencias.push({ k: 'meta', txt: 'Publicidad en Meta Ads (IG / FB)' });

    const ultAccion = acciones[0] || null;
    return {
      ...c,
      esLead,
      dias_sin_servicio: c.ultimo_unico ? diasDesde(c.ultimo_unico) : null,
      hizo,
      sugerencias,
      acciones,
      ult_accion: ultAccion,
      dias_ult_contacto: ultAccion ? diasDesde(ultAccion.fecha) : null,
      pendiente: acciones.some((a) => ['ofrecido', 'esperando', 'interesado'].includes(a.resultado)),
    };
  }

  for (const c of filas) {
    const tieneServicio = c.rec_activos > 0;
    const dsc = c.ultimo_unico ? diasDesde(c.ultimo_unico) : null;
    const esLead = !tieneServicio && (c.estado === 'inactivo' || c.estado === 'potencial' || dsc === null || dsc > 60);
    if (esLead) items.set(c.id, armar(c, true));
  }

  // Sumar clientes con seguimiento de marketing aunque ya no sean "lead".
  const conAcciones = db.prepare('SELECT DISTINCT cliente_id FROM marketing_acciones').all().map((r) => r.cliente_id);
  for (const cid of conAcciones) {
    if (items.has(cid)) continue;
    const c = filas.find((x) => x.id === cid);
    if (c) items.set(cid, armar(c, false));
  }

  const leads = [...items.values()].sort((a, b) => {
    if (a.pendiente !== b.pendiente) return a.pendiente ? -1 : 1;
    const da = a.dias_sin_servicio == null ? 1e9 : a.dias_sin_servicio;
    const dbb = b.dias_sin_servicio == null ? 1e9 : b.dias_sin_servicio;
    return dbb - da;
  });

  res.render('marketing/index', { titulo: 'Marketing', leads, SERVICIOS, RESULTADOS, etiquetaServicio, hoyISO: hoyISO() });
});

// Registrar que se ofreció un servicio / se hizo un contacto.
router.post('/:cid/accion', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.cid);
  if (!cliente) return res.redirect('/marketing');
  const servicio = SERVICIOS.includes(req.body.servicio) ? req.body.servicio : 'otro';
  const resultado = RESULTADOS.includes(req.body.resultado) ? req.body.resultado : 'ofrecido';
  const fecha = req.body.fecha ? String(req.body.fecha).slice(0, 10) : hoyISO();
  const detalle = String(req.body.detalle || '').trim().slice(0, 500);

  db.prepare(`
    INSERT INTO marketing_acciones (cliente_id, servicio, detalle, fecha, resultado, registrado_por)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(cliente.id, servicio, detalle, fecha, resultado, req.session.user.nombre);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Marketing: ${resultado} "${etiquetaServicio(servicio)}" el ${fecha}${detalle ? ' — ' + detalle : ''}`);
  req.session.flash = { tipo: 'ok', msg: `Registrado: ${etiquetaServicio(servicio)} — ${fecha}.` };
  res.redirect('/marketing#c' + cliente.id);
});

// Cambiar el resultado o borrar una acción.
router.post('/acciones/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM marketing_acciones WHERE id = ?').get(req.params.id);
  if (!a) return res.redirect('/marketing');
  if (req.body._accion === 'eliminar') {
    db.prepare('DELETE FROM marketing_acciones WHERE id = ?').run(a.id);
    req.session.flash = { tipo: 'ok', msg: 'Acción eliminada.' };
  } else if (RESULTADOS.includes(req.body.resultado)) {
    db.prepare('UPDATE marketing_acciones SET resultado = ? WHERE id = ?').run(req.body.resultado, a.id);
    audit.registrar(req, 'clientes', a.cliente_id, 'editar', `Marketing: "${etiquetaServicio(a.servicio)}" → ${req.body.resultado}`);
    req.session.flash = { tipo: 'ok', msg: 'Resultado actualizado.' };
  }
  res.redirect('/marketing#c' + a.cliente_id);
});

module.exports = router;
