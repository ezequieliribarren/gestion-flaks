'use strict';

const bcrypt = require('bcryptjs');
const db = require('./index');

// Limpia comillas o espacios que a veces quedan al pegar valores en el panel de Hostinger.
function limpiar(v) {
  if (v == null) return '';
  let s = String(v).trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

function upsertUser(nombre, usuarioRaw, passwordRaw, rol, log) {
  const usuario = limpiar(usuarioRaw);
  const password = limpiar(passwordRaw);
  if (!usuario || !password) return { hecho: false, faltan: true };

  const existente = db.prepare('SELECT id FROM users WHERE lower(usuario) = lower(?)').get(usuario);
  const hash = bcrypt.hashSync(password, 10);
  if (existente) {
    db.prepare('UPDATE users SET nombre = ?, usuario = ?, password_hash = ?, rol = ? WHERE id = ?')
      .run(nombre, usuario, hash, rol, existente.id);
    log(`= Usuario actualizado: "${usuario}" [${rol}] (largo de contraseña: ${password.length})`);
  } else {
    db.prepare('INSERT INTO users (nombre, usuario, password_hash, rol) VALUES (?, ?, ?, ?)')
      .run(nombre, usuario, hash, rol);
    log(`+ Usuario creado: "${usuario}" [${rol}] (largo de contraseña: ${password.length})`);
  }
  return { hecho: true };
}

// Crea/actualiza los usuarios desde las variables de entorno. Idempotente.
function seedUsers(log = console.log) {
  const g = upsertUser('German', process.env.GERMAN_USERNAME, process.env.GERMAN_PASSWORD, 'admin', log);
  const e = upsertUser('Ezequiel', process.env.EZEQUIEL_USERNAME, process.env.EZEQUIEL_PASSWORD, 'admin', log);
  if (g.faltan) log('! Falta GERMAN_USERNAME / GERMAN_PASSWORD — se omite.');
  if (e.faltan) log('! Falta EZEQUIEL_USERNAME / EZEQUIEL_PASSWORD — se omite.');

  // Usuario opcional con acceso SOLO al módulo Contenido.
  const c = upsertUser(
    limpiar(process.env.CONTENIDO_NOMBRE) || 'Contenido',
    process.env.CONTENIDO_USERNAME,
    process.env.CONTENIDO_PASSWORD,
    'contenido',
    log
  );
  if (c.faltan) log('· CONTENIDO_USERNAME / CONTENIDO_PASSWORD no configurados — sin usuario de contenido (opcional).');

  const total = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  log(`Usuarios en la base: ${total}`);
  return g.hecho || e.hecho || c.hecho;
}

module.exports = { seedUsers };
