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

const APP_TZ = process.env.APP_TZ || 'America/Argentina/Buenos_Aires';

// "Ahora" en la zona horaria de la app: { iso: 'YYYY-MM-DD', hora: 0-23 }.
function ahora() {
  let s;
  try {
    s = new Date().toLocaleString('sv-SE', { timeZone: APP_TZ }); // "2026-09-09 14:30:00"
  } catch (e) {
    s = new Date().toISOString().replace('T', ' ').slice(0, 19);
  }
  return { iso: s.slice(0, 10), hora: Number(s.slice(11, 13)) || 0, texto: s };
}

// Estado de vencimiento de una tarea. fechaCierre = 'YYYY-MM-DD' (o null).
// Regla: vencen a las 19 hs; después de esa hora (o cualquier día anterior) están vencidas.
function estadoVencimiento(fechaCierre, completada) {
  if (!fechaCierre || completada) return { vencida: false, dias: 0, venceHoy: false };
  const f = String(fechaCierre).slice(0, 10);
  const n = ahora();
  const dias = Math.round((Date.parse(n.iso) - Date.parse(f)) / 86400000);
  if (dias > 0) return { vencida: true, dias, venceHoy: false };
  if (dias === 0) {
    return n.hora >= 19
      ? { vencida: true, dias: 0, venceHoy: false }
      : { vencida: false, dias: 0, venceHoy: true };
  }
  return { vencida: false, dias: 0, venceHoy: false };
}

function textoVencida(v) {
  if (v.venceHoy) return 'Vence hoy 19 hs';
  if (!v.vencida) return '';
  if (v.dias === 0) return 'Vencida hoy';
  if (v.dias === 1) return 'Vencida de ayer';
  return `Vencida hace ${v.dias} días`;
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
  ahora,
  estadoVencimiento,
  textoVencida,
  MESES,
};
