'use strict';

// Une, una sola vez, los clientes ya existentes de Sistema Continuo bajo un mismo
// grupo (SENKO, ARTANIUM y SISTEMA CONTINUO GF pasan a depender de SISTEMA CONTINUO).
// Idempotente vía app_meta: si un admin los desvincula después a mano en Clientes,
// no se vuelven a enlazar solos en el próximo boot.
// Corre después de importarDatosIniciales() porque necesita que esos clientes ya existan.

const db = require('./index');

const MARCA = 'grupo_sistema_continuo_v1';
const HIJOS = ['SENKO', 'ARTANIUM', 'SISTEMA CONTINUO GF'];

function vincularGrupoSistemaContinuo() {
  if (db.prepare('SELECT valor FROM app_meta WHERE clave = ?').get(MARCA)) return false;

  const padre = db.prepare("SELECT id FROM clientes WHERE nombre = 'SISTEMA CONTINUO'").get();
  if (padre) {
    const upd = db.prepare('UPDATE clientes SET grupo_id = ? WHERE nombre = ? AND grupo_id IS NULL');
    HIJOS.forEach((nombre) => upd.run(padre.id, nombre));
  }
  db.prepare('INSERT OR REPLACE INTO app_meta (clave, valor) VALUES (?, ?)').run(MARCA, new Date().toISOString());
  return true;
}

module.exports = { vincularGrupoSistemaContinuo };
