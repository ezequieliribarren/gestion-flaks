'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

const RE_WEB = /web|landing|wordpress|tienda|sitio|multip[aá]gina|p[aá]gina|ecommerce|e-commerce|institucional|catalogo|catálogo/i;
const RE_GOOGLE = /google ads|adwords|google adwords|sem\b/i;
const RE_META = /meta ads|facebook ads|instagram ads|meta\b|fb ads/i;
const RE_REDES = /redes|community|contenido|social|instagram|posteo|reels|historias/i;

router.get('/', (req, res) => {
  // Clientes SIN un servicio recurrente activo (los "vigentes" no son leads).
  const filas = db.prepare(`
    SELECT c.id, c.nombre, c.logo, c.estado, c.redes,
      (SELECT COUNT(*) FROM trabajos_recurrentes WHERE cliente_id = c.id AND activo = 1) AS rec_activos,
      (SELECT MAX(fecha) FROM trabajos_unicos WHERE cliente_id = c.id AND estado = 'realizado') AS ultimo_unico
    FROM clientes c
    ORDER BY c.nombre COLLATE NOCASE
  `).all();

  const hoy = new Date();
  const leads = [];
  for (const c of filas) {
    if (c.rec_activos > 0) continue; // tiene un servicio mensual en curso

    // ¿hace cuánto que no tiene un servicio?
    let diasSinServicio = null;
    if (c.ultimo_unico) {
      diasSinServicio = Math.round((hoy - Date.parse(c.ultimo_unico + 'T00:00:00')) / 86400000);
    }
    // criterio: inactivo, o potencial, o hace > 60 días sin nada
    const califica = c.estado === 'inactivo' || c.estado === 'potencial' ||
      diasSinServicio === null || diasSinServicio > 60;
    if (!califica) continue;

    const trabajos = db.prepare(`
      SELECT nombre FROM trabajos_unicos WHERE cliente_id = ?
      UNION ALL SELECT nombre FROM trabajos_recurrentes WHERE cliente_id = ?
    `).all(c.id, c.id).map((t) => t.nombre).join(' | ');

    const hizoWeb = RE_WEB.test(trabajos);
    const hizoGoogle = RE_GOOGLE.test(trabajos);
    const hizoMeta = RE_META.test(trabajos);
    const hizoRedes = c.redes === 1 || RE_REDES.test(trabajos);

    const sugerencias = [];
    if (!hizoRedes) sugerencias.push({ k: 'redes', txt: 'Gestión de redes sociales / contenido' });
    if (!hizoGoogle) sugerencias.push({ k: 'google', txt: 'Publicidad en Google Ads' });
    if (!hizoMeta) sugerencias.push({ k: 'meta', txt: 'Publicidad en Meta Ads (IG / FB)' });

    leads.push({
      ...c,
      dias_sin_servicio: diasSinServicio,
      hizo: { web: hizoWeb, google: hizoGoogle, meta: hizoMeta, redes: hizoRedes },
      sugerencias,
    });
  }

  // primero los que hace más que no tienen servicio (o nunca)
  leads.sort((a, b) => (b.dias_sin_servicio == null ? 1e9 : b.dias_sin_servicio) - (a.dias_sin_servicio == null ? 1e9 : a.dias_sin_servicio));

  res.render('marketing/index', { titulo: 'Marketing', leads });
});

module.exports = router;
