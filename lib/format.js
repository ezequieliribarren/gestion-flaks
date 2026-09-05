'use strict';

// Helpers de formato: moneda ARS y fechas DD/MM/AAAA.

function formatARS(value) {
  const n = Number(value || 0);
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Recibe 'YYYY-MM-DD' o 'YYYY-MM-DD HH:MM:SS' (hora en UTC, como la guarda SQLite).
function formatFecha(value) {
  if (!value) return '';
  const s = String(value).replace(' ', 'T');
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s + 'Z');
  if (isNaN(d)) return String(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatFechaHora(value) {
  if (!value) return '';
  const s = String(value).replace(' ', 'T');
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s + 'Z');
  if (isNaN(d)) return String(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function nombreMes(m) {
  return MESES[(Number(m) - 1 + 12) % 12] || '';
}

// Devuelve { anio, mes } validados; si no vienen, usa el mes actual.
function periodoDesde(query) {
  const now = new Date();
  let anio = parseInt(query.anio, 10);
  let mes = parseInt(query.mes, 10);
  if (!anio || anio < 2000 || anio > 2100) anio = now.getFullYear();
  if (!mes || mes < 1 || mes > 12) mes = now.getMonth() + 1;
  return { anio, mes };
}

module.exports = {
  formatARS,
  formatFecha,
  formatFechaHora,
  nombreMes,
  periodoDesde,
  MESES,
};
