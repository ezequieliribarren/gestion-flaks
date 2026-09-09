'use strict';

const express = require('express');
const db = require('../db');
const fmt = require('../lib/format');

const router = express.Router();

router.get('/', (req, res) => {
  const uid = req.session.user.id;
  const notifs = db.prepare(`
    SELECT * FROM notificaciones WHERE user_id = ? ORDER BY creada_en DESC, id DESC LIMIT 100
  `).all(uid);
  // al abrir la lista, se marcan todas como leídas
  db.prepare('UPDATE notificaciones SET leida = 1 WHERE user_id = ? AND leida = 0').run(uid);
  res.render('notificaciones/index', { titulo: 'Notificaciones', notifs, fmt });
});

// Ir a una notificación puntual (marca leída y redirige a su tarea).
router.get('/:id/ir', (req, res) => {
  const n = db.prepare('SELECT * FROM notificaciones WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!n) return res.redirect('/notificaciones');
  db.prepare('UPDATE notificaciones SET leida = 1 WHERE id = ?').run(n.id);
  res.redirect(n.url || '/notificaciones');
});

router.post('/marcar-todas', (req, res) => {
  db.prepare('UPDATE notificaciones SET leida = 1 WHERE user_id = ?').run(req.session.user.id);
  res.redirect('/notificaciones');
});

module.exports = router;
