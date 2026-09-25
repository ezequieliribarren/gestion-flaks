'use strict';

const db = require('../db');
const fmt = require('./format');
const { notificarAdmins } = require('./participacion');

let ultimaRevision = 0;

// 3 días antes (o menos, si el server estuvo caído justo esos días) de la fecha de
// un vencimiento activo y todavía no notificado, crea la tarea "Renovar <nombre>
// [- <cliente>]" (con tag "Importante") y una notificación. Idempotente vía
// vencimientos.notificado_en: no se dispara dos veces para la misma fecha, pero si se
// edita la fecha (routes/clientes.js, routes/tareas.js) se limpia y puede volver a avisar.
function revisar() {
  const { iso } = fmt.ahora();
  const limite = new Date(iso + 'T00:00:00');
  limite.setDate(limite.getDate() + 3);
  const fechaLimite = limite.toISOString().slice(0, 10);

  const pendientes = db.prepare(`
    SELECT v.*, c.nombre AS cliente_nombre
    FROM vencimientos v LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE v.activo = 1 AND v.notificado_en IS NULL AND v.fecha <= ?
  `).all(fechaLimite);

  let creadas = 0;
  for (const v of pendientes) {
    const nombreTarea = v.cliente_id ? `Renovar ${v.nombre} - ${v.cliente_nombre}` : `Renovar ${v.nombre}`;
    const info = db.prepare(`
      INSERT INTO tareas (nombre, descripcion, prioridad, fecha_cierre, cliente_id, interna, origen, creado_por, ultima_modificacion_por, ultima_modificacion_en)
      VALUES (?, ?, 'alta', ?, ?, ?, 'vencimiento', 'Sistema', 'Sistema', datetime('now'))
    `).run(
      nombreTarea,
      `Vencimiento automático: "${v.nombre}" vence el ${fmt.formatFecha(v.fecha)}.` + (v.notas ? ` ${v.notas}` : ''),
      v.fecha,
      v.cliente_id || null,
      v.cliente_id ? 0 : 1
    );
    notificarAdmins(
      'vencimiento',
      v.id,
      `${nombreTarea}: vence el ${fmt.formatFecha(v.fecha)}.`,
      v.cliente_id ? '/clientes/' + v.cliente_id : '/tareas/flaks#vencimientos',
      null
    );
    db.prepare('UPDATE vencimientos SET notificado_en = ? WHERE id = ?').run(iso, v.id);
    creadas++;
  }
  return creadas;
}

// Versión "barata" para el middleware: revisa como máximo cada 1 hora.
function revisarThrottled() {
  const ahora = Date.now();
  if (ahora - ultimaRevision < 60 * 60 * 1000) return;
  ultimaRevision = ahora;
  try { revisar(); } catch (e) { console.error('revisar vencimientos:', e.message); }
}

module.exports = { revisar, revisarThrottled };
