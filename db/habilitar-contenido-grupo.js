'use strict';

// Habilita (una sola vez) el módulo de Contenido para los sub-clientes de Sistema
// Continuo (SENKO, ARTANIUM, SISTEMA CONTINUO GF), para que cada uno tenga su
// propio plan/sheet/metas semanales y aparezcan como solapas dentro de SISTEMA
// CONTINUO en vez de como tarjetas sueltas en /contenido.
// Idempotente vía app_meta: si un admin los saca después a mano, no se reactivan solos.
// Corre después de vincular-grupo.js (necesita que ya existan como clientes).

const db = require('./index');

const MARCA = 'contenido_grupo_sistema_continuo_v1';
const HIJOS = ['SENKO', 'ARTANIUM', 'SISTEMA CONTINUO GF'];

function habilitarContenidoGrupoSistemaContinuo() {
  if (db.prepare('SELECT valor FROM app_meta WHERE clave = ?').get(MARCA)) return false;

  const upd = db.prepare('UPDATE clientes SET redes = 1 WHERE nombre = ?');
  HIJOS.forEach((nombre) => upd.run(nombre));

  db.prepare('INSERT OR REPLACE INTO app_meta (clave, valor) VALUES (?, ?)').run(MARCA, new Date().toISOString());
  return true;
}

module.exports = { habilitarContenidoGrupoSistemaContinuo };
