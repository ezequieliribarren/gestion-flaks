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

function upsertUser(nombre, usuarioRaw, passwordRaw, log) {
  const usuario = limpiar(usuarioRaw);
  const password = limpiar(passwordRaw);
  if (!usuario || !password) {
    log(`! Falta usuario/contraseña para ${nombre} (revisá las variables de entorno) — se omite.`);
    return false;
  }
  const existente = db.prepare('SELECT id FROM users WHERE lower(usuario) = lower(?)').get(usuario);
  const hash = bcrypt.hashSync(password, 10);
  if (existente) {
    db.prepare('UPDATE users SET nombre = ?, usuario = ?, password_hash = ? WHERE id = ?')
      .run(nombre, usuario, hash, existente.id);
    log(`= Usuario actualizado: "${usuario}" (largo de contraseña: ${password.length})`);
  } else {
    db.prepare('INSERT INTO users (nombre, usuario, password_hash) VALUES (?, ?, ?)')
      .run(nombre, usuario, hash);
    log(`+ Usuario creado: "${usuario}" (largo de contraseña: ${password.length})`);
  }
  return true;
}

// Crea/actualiza a German y Ezequiel desde las variables de entorno. Idempotente.
function seedUsers(log = console.log) {
  const a = upsertUser('German', process.env.GERMAN_USERNAME, process.env.GERMAN_PASSWORD, log);
  const b = upsertUser('Ezequiel', process.env.EZEQUIEL_USERNAME, process.env.EZEQUIEL_PASSWORD, log);
  const total = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  log(`Usuarios en la base: ${total}`);
  return a || b;
}

module.exports = { seedUsers };
