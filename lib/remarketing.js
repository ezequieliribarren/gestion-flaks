'use strict';

const db = require('../db');
const fmt = require('./format');
const { notificarAdmins } = require('./participacion');

let ultimaRevision = 0;

// Revisa los recordatorios de re-marketing vencidos (fecha <= hoy y sin notificar)
// y genera una notificación para los admin. Idempotente.
function revisar() {
  const hoy = fmt.ahora().iso;
  const pend = db.prepare(`
    SELECT r.id, r.fecha, r.nota, c.id AS cliente_id, c.nombre AS cliente
    FROM remarketing_recordatorios r
    JOIN clientes c ON c.id = r.cliente_id
    WHERE r.notificado = 0 AND substr(r.fecha, 1, 10) <= ?
  `).all(hoy);

  for (const r of pend) {
    const txt = `Re-marketing: contactar a ${r.cliente}` + (r.nota ? ` — ${r.nota}` : '');
    notificarAdmins('remarketing', r.cliente_id, txt, '/clientes/' + r.cliente_id, null);
    db.prepare('UPDATE remarketing_recordatorios SET notificado = 1 WHERE id = ?').run(r.id);
  }
  return pend.length;
}

// Versión "barata" para llamar desde un middleware: sólo revisa cada 10 min.
function revisarThrottled() {
  const ahora = Date.now();
  if (ahora - ultimaRevision < 10 * 60 * 1000) return;
  ultimaRevision = ahora;
  try { revisar(); } catch (e) { console.error('revisar remarketing:', e.message); }
}

module.exports = { revisar, revisarThrottled };
