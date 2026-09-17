'use strict';

const db = require('../db');
const fmt = require('./format');

function periodoActual() {
  return fmt.ahora().iso.slice(0, 7);
}

// Todos los objetivos del período actual (mensuales) + los de largo plazo,
// cumplidos incluidos (para la solapa de Objetivos dentro de Tareas).
function objetivosDelPeriodo(periodo) {
  const mensuales = db.prepare("SELECT * FROM objetivos WHERE tipo = 'mensual' AND periodo = ? ORDER BY cumplido ASC, id DESC").all(periodo);
  const largoPlazo = db.prepare("SELECT * FROM objetivos WHERE tipo = 'largo_plazo' ORDER BY cumplido ASC, id DESC").all();
  return { periodo, mensuales, largoPlazo };
}

// Sólo los pendientes (no cumplidos), para la tarjeta de Inicio.
function objetivosVigentes() {
  const periodo = periodoActual();
  const mensuales = db.prepare("SELECT * FROM objetivos WHERE tipo = 'mensual' AND periodo = ? AND cumplido = 0 ORDER BY id DESC").all(periodo);
  const largoPlazo = db.prepare("SELECT * FROM objetivos WHERE tipo = 'largo_plazo' AND cumplido = 0 ORDER BY id DESC").all();
  return { mensuales, largoPlazo, total: mensuales.length + largoPlazo.length };
}

module.exports = { periodoActual, objetivosDelPeriodo, objetivosVigentes };
