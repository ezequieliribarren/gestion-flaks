'use strict';

const db = require('../db');

const TIPOS = ['historias', 'reels', 'posteos', 'carrusel', 'otro'];
const ESTADOS_TAREA = ['pendiente', 'en_progreso', 'completada'];

function etiquetaTipo(t) {
  return { historias: 'Historias', reels: 'Reels', posteos: 'Posteos', carrusel: 'Carrusel', otro: 'Otro' }[t] || t;
}
function etiquetaEstadoTarea(e) {
  return { pendiente: 'Pendiente', en_progreso: 'En progreso', completada: 'Completada' }[e] || e;
}

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|igshid|igsh|si|feature|ref|ref_src|ref_url|s)$/i;

// Normaliza un link para poder detectar repetidos aunque cambien mayúsculas,
// la barra final o parámetros de tracking.
function normalizarUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  try {
    const url = new URL(s.includes('://') ? s : 'https://' + s);
    url.hash = '';
    const quitar = [];
    url.searchParams.forEach((_v, k) => { if (TRACKING.test(k)) quitar.push(k); });
    quitar.forEach((k) => url.searchParams.delete(k));
    let host = url.host.toLowerCase().replace(/^www\./, '');
    let out = host + url.pathname.replace(/\/+$/, '') + (url.search || '');
    return out.toLowerCase();
  } catch (e) {
    return s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
  }
}

// Devuelve, para un link, dónde/cuándo se usó antes (otras filas realizadas con la misma URL).
function usoPrevio(urlNorm, excluirId) {
  if (!urlNorm) return null;
  return db.prepare(`
    SELECT cl.realizado_en, c.nombre AS cliente, cl.cliente_id
    FROM contenido_links cl
    JOIN clientes c ON c.id = cl.cliente_id
    WHERE cl.url_norm = ? AND cl.realizado = 1 AND cl.id <> ?
    ORDER BY cl.realizado_en ASC
    LIMIT 1
  `).get(urlNorm, excluirId || 0);
}

module.exports = { TIPOS, ESTADOS_TAREA, etiquetaTipo, etiquetaEstadoTarea, normalizarUrl, usoPrevio };
