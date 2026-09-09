'use strict';

const db = require('../db');

function usuarios() {
  return db.prepare('SELECT id, nombre, rol FROM users ORDER BY nombre').all();
}

function asignadosDe(tipo, refId) {
  return db.prepare(`
    SELECT u.id, u.nombre
    FROM asignaciones a JOIN users u ON u.id = a.user_id
    WHERE a.tipo = ? AND a.ref_id = ?
    ORDER BY u.nombre
  `).all(tipo, refId);
}

function asignadosIds(tipo, refId) {
  return db.prepare('SELECT user_id FROM asignaciones WHERE tipo = ? AND ref_id = ?').all(tipo, refId).map((r) => r.user_id);
}

// Reemplaza la lista de asignados. userIds: array de ids (números).
function setAsignados(tipo, refId, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter((n) => n > 0))];
  db.prepare('DELETE FROM asignaciones WHERE tipo = ? AND ref_id = ?').run(tipo, refId);
  const ins = db.prepare('INSERT OR IGNORE INTO asignaciones (tipo, ref_id, user_id) VALUES (?, ?, ?)');
  for (const uid of ids) {
    if (db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) ins.run(tipo, refId, uid);
  }
}

const insNotif = db.prepare(`
  INSERT INTO notificaciones (user_id, tipo, ref_id, texto, url, de_quien)
  VALUES (@user_id, @tipo, @ref_id, @texto, @url, @de_quien)
`);

// Notifica a los participantes de una tarea (asignados + creador), salvo al que hizo el cambio.
function notificarParticipantes(tipo, refId, creadoPor, actorUser, { texto, url }) {
  const dest = new Set(asignadosIds(tipo, refId));
  if (creadoPor) {
    const c = db.prepare('SELECT id FROM users WHERE nombre = ?').get(creadoPor);
    if (c) dest.add(c.id);
  }
  const actorId = actorUser && actorUser.id;
  for (const uid of dest) {
    if (uid === actorId) continue;
    insNotif.run({ user_id: uid, tipo, ref_id: refId, texto, url: url || null, de_quien: (actorUser && actorUser.nombre) || null });
  }
}

function contarNoLeidas(userId) {
  if (!userId) return 0;
  return db.prepare('SELECT COUNT(*) AS n FROM notificaciones WHERE user_id = ? AND leida = 0').get(userId).n;
}

module.exports = { usuarios, asignadosDe, asignadosIds, setAsignados, notificarParticipantes, contarNoLeidas };
