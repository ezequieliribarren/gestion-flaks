'use strict';

const db = require('../db');
const fmt = require('./format');

// Catálogo de tarjetas del Inicio (id interno + etiqueta, para el listado de "ocultas").
const TARJETAS = [
  { id: 'tareas_vencidas', label: 'Tareas vencidas' },
  { id: 'contenido_semana', label: 'Contenido de la semana' },
  { id: 'saldo_socios', label: 'Saldo entre socios' },
  { id: 'pagos_pendientes', label: 'Pagos de clientes pendientes' },
  { id: 'facturado_mes', label: 'Facturado del mes' },
  { id: 'dolar_mep', label: 'Dólar MEP' },
  { id: 'clima', label: 'Clima Capital Federal' },
];

const FRASES = [
  'Otra semana, a darle',
  'Arrancamos con todo',
  'Vamos por una gran semana',
  'A full esta semana',
  'Nueva semana, nuevas metas',
  'Con energía para esta semana',
  'A meterle ganas',
  'Semana nueva, cuenta nueva',
  'Vamos que se puede',
  'A romperla esta semana',
];

// Número de semana ISO del año (1-53), estable toda la semana.
function numeroSemana(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00Z');
  const dia = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dia + 3);
  const primerJueves = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const diffSemanas = Math.round((d - primerJueves) / (7 * 86400000));
  return 1 + diffSemanas;
}

// Saludo personalizado que cambia cada semana (misma frase toda la semana, distinta la próxima).
function saludo(nombre) {
  const semana = numeroSemana(fmt.ahora().iso);
  const frase = FRASES[semana % FRASES.length];
  const primerNombre = String(nombre || '').trim().split(/\s+/)[0] || nombre;
  return `${frase}, ${primerNombre}`;
}

function ocultasDe(userId) {
  return new Set(
    db.prepare('SELECT tarjeta FROM inicio_ocultas WHERE user_id = ?').all(userId).map((r) => r.tarjeta)
  );
}

function ocultar(userId, tarjeta) {
  db.prepare('INSERT OR IGNORE INTO inicio_ocultas (user_id, tarjeta) VALUES (?, ?)').run(userId, tarjeta);
}

function mostrar(userId, tarjeta) {
  db.prepare('DELETE FROM inicio_ocultas WHERE user_id = ? AND tarjeta = ?').run(userId, tarjeta);
}

// Las tarjetas de "pago pendiente" son una por deuda (id dinámico "pago_<tipo>_<id>").
// Si el usuario ocultó una y esa deuda ya no existe (se cobró, se borró, etc.), se
// limpia sola para no acumular basura en inicio_ocultas.
function limpiarPagosOcultosResueltos(userId, idsVigentes) {
  const vigentes = new Set(idsVigentes);
  const filas = db.prepare('SELECT tarjeta FROM inicio_ocultas WHERE user_id = ?').all(userId);
  const del = db.prepare('DELETE FROM inicio_ocultas WHERE user_id = ? AND tarjeta = ?');
  filas.forEach((f) => {
    if (f.tarjeta.indexOf('pago_') === 0 && !vigentes.has(f.tarjeta)) del.run(userId, f.tarjeta);
  });
}

module.exports = { TARJETAS, saludo, ocultasDe, ocultar, mostrar, limpiarPagosOcultosResueltos };
