'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/tareas');
  res.render('login', { layout: false, error: null });
});

router.post('/login', (req, res) => {
  const usuario = String(req.body.usuario || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const user = db.prepare('SELECT * FROM users WHERE lower(usuario) = ?').get(usuario);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', { layout: false, error: 'Usuario o contraseña incorrectos.' });
  }

  req.session.user = { id: user.id, nombre: user.nombre, usuario: user.usuario };
  const dest = req.session.returnTo || '/tareas';
  delete req.session.returnTo;
  res.redirect(dest);
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
