'use strict';

const db = require('../db');

// Metas de posteos por semana ya cargadas para un cliente en un período ('YYYY-MM').
// Devuelve { [numSemana]: meta }.
function metasSemanaDe(clienteId, periodo) {
  const filas = db.prepare('SELECT semana, meta FROM redes_metas_semana WHERE cliente_id = ? AND periodo = ?').all(clienteId, periodo);
  const out = {};
  filas.forEach((f) => { out[f.semana] = f.meta; });
  return out;
}

module.exports = { metasSemanaDe };
