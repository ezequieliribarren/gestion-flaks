'use strict';

// Exige sesión iniciada. Se aplica a todo salvo /login y /public.
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    res.locals.currentUser = req.session.user;
    return next();
  }
  if (req.method === 'GET' && req.accepts('html')) {
    req.session.returnTo = req.originalUrl;
  }
  return res.redirect('/login');
}

function esAdmin(user) {
  return !!user && user.rol !== 'contenido';
}

// Bloquea a los usuarios que sólo tienen acceso al módulo Contenido.
function soloAdmin(req, res, next) {
  if (esAdmin(req.session && req.session.user)) return next();
  return res.redirect('/contenido');
}

module.exports = { requireAuth, soloAdmin, esAdmin };
