'use strict';

const db = require('../db');
const fmt = require('./format');

// Catálogo de tarjetas del Inicio (id interno + etiqueta, para el listado de "ocultas").
const TARJETAS = [
  { id: 'tareas_vencidas', label: 'Tareas vencidas' },
  { id: 'vencimientos_importantes', label: 'Vencimientos importantes (renovaciones)' },
  { id: 'contenido_semana', label: 'Contenido de la semana' },
  { id: 'saldo_socios', label: 'Saldo entre socios' },
  { id: 'pagos_pendientes', label: 'Pagos pendientes de este mes' },
  { id: 'deuda_antigua', label: 'Deuda de meses anteriores' },
  { id: 'facturado_mes', label: 'Facturado del mes (anterior / actual / siguiente)' },
  { id: 'gasto_publicidad', label: 'Gasto en publicidad y ROAS de clientes nuevos' },
  { id: 'dolar_mep', label: 'Dólar MEP' },
  { id: 'clima', label: 'Clima Capital Federal' },
  { id: 'objetivos', label: 'Objetivos a la vista' },
];

// Frases positivas que van rotando día por día (no se repiten hasta agotar la lista).
const FRASES = [
  'Hoy es un gran día para avanzar',
  'Vamos con todo',
  'Un paso más cerca de tus objetivos',
  'Que tengas un día productivo',
  'A darle con energía',
  'Hoy se suma un logro más',
  'Vas por buen camino',
  'A meterle ganas hoy',
  'Un día más para crecer',
  'Con todo para hoy',
  'Hoy es buen día para cerrar algo pendiente',
  'A disfrutar del proceso',
  'Cada día cuenta, y hoy también',
  'Vamos que se puede',
  'A romperla hoy',
  'Un día más, un paso más',
  'Hoy toca sumar',
  'Con buena onda para arrancar',
  'A construir un gran día',
  'Hoy es una buena oportunidad',
  'Vamos por más',
  'A disfrutar lo que se viene',
];

// Número de día (entero, siempre creciente) para rotar la frase una vez por día.
function numeroDia(fechaISO) {
  return Math.floor(Date.parse(fechaISO + 'T00:00:00Z') / 86400000);
}

// Saludo personalizado que cambia cada día (misma frase todo el día, distinta al siguiente).
function saludo(nombre) {
  const dia = numeroDia(fmt.ahora().iso);
  const frase = FRASES[dia % FRASES.length];
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

module.exports = { TARJETAS, saludo, ocultasDe, ocultar, mostrar };
