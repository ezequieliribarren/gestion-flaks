'use strict';

/*
 * Herramienta de desarrollo (no se usa en producción).
 * Lee "anterior/TODO MARCADOR.xlsx" y genera "db/datos-iniciales.json"
 * con clientes / trabajos únicos / gastos para importar al dashboard.
 *
 * Uso:  node scripts/generar-datos-iniciales.js
 * Requiere la devDependency "xlsx".
 */

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const XLSX_PATH = path.join(__dirname, '..', 'anterior', 'TODO MARCADOR.xlsx');
const OUT_PATH = path.join(__dirname, '..', 'db', 'datos-iniciales.json');

const wb = XLSX.readFile(XLSX_PATH);
const hoja = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });

// --- helpers ---------------------------------------------------------------

function plata(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function diasEnMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
}

// Arma 'YYYY-MM-DD' usando AÑO/MES de las columnas y el día de la celda FECHA.
function fechaDe(anio, mes, fechaCelda) {
  let a = parseInt(anio, 10);
  let m = parseInt(mes, 10);
  if (!a || a < 2000 || a > 2100) a = new Date().getFullYear();
  if (!m || m < 1 || m > 12) m = 1;
  let d = 1;
  const mm = String(fechaCelda || '').match(/^(\d{1,2})\s*[\/\-]/);
  if (mm) d = parseInt(mm[1], 10);
  if (!d || d < 1) d = 1;
  d = Math.min(d, diasEnMes(a, m));
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Nombres que en la planilla figuran distinto pero son el mismo cliente.
const ALIAS = {
  'TOBYCO': 'TOBYCO',
  'AZULCIELO': 'AZUL CIELO',
  'STRYCEK': 'FARMACIA STRYCEK',
  'STRYCEK FARMACIA': 'FARMACIA STRYCEK',
  'ESMERALDA': 'ESMERALDA HEBE',
  'BRODERIDESIGN': 'BRODERI',
  'FILOMENA PIJAMAS': 'FILOMENA',
  'DIEGO ZAPATA ANDIELCO': 'ANDIELCO',
  'LUSQTOFF TIGRE': 'LUSQTOFF TIGRE',
};

function canonCliente(nombre) {
  const n = norm(nombre);
  const up = n.toUpperCase();
  return ALIAS[up] || n;
}

// Etiquetas de EGRESO que NO son gastos operativos (son retiros / reparto de ganancia).
const EGRESO_EXCLUIR = /honorari|saldo german|saldo eze|ganancia|reparto|retiro/i;

function categoriaGasto(label, desc) {
  const t = `${label} ${desc}`.toUpperCase();
  if (/PAUTA|PUBLICID|META ADS|GOOGLE ADS|TIK ?TOK/.test(t)) return 'Publicidad';
  if (/HERRAMIENT|CAPCUT|CANVA|MOVAVI|METRICOOL|FREEPIK|MAILERFIND|LÍNEA|LINEA|MOVISTAR/.test(t)) return 'Herramientas';
  if (/HOSTING|DOMINIO/.test(t)) return 'Hosting';
  if (/COMIDA|ALMUERZO|MERIENDA|VIANDA/.test(t)) return 'Comida';
  if (/MICROFONO|TECNOLOG|EQUIPARA|EQUIPAM|NOTEBOOK|MONITOR/.test(t)) return 'Equipamiento';
  if (/VUELO|PASAJE|VIATIC/.test(t)) return 'Viáticos';
  return 'Otros';
}

const PALETA = [
  '#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2',
  '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#b45309',
];

// --- clientes -------------------------------------------------------------

const clientesMap = new Map(); // nombre canónico -> { nombre, mensual }

function registrarCliente(nombre, { mensual = false } = {}) {
  const c = canonCliente(nombre);
  if (!c) return null;
  if (!clientesMap.has(c)) clientesMap.set(c, { nombre: c, mensual: false });
  if (mensual) clientesMap.get(c).mensual = true;
  return c;
}

// Hoja "CLIENTES FLAKS": lista principal + sub-lista de "clientes activos MENSUALES".
{
  const cf = hoja('CLIENTES FLAKS');
  let enMensuales = false;
  for (let i = 3; i < cf.length; i++) {
    const nombre = norm(cf[i][1]);
    if (!nombre) continue;
    if (/clientes activos mensuales/i.test(nombre)) { enMensuales = true; continue; }
    if (/^(REDES|PUBLICIDAD)\s*\d+$/i.test(nombre)) continue; // placeholders
    registrarCliente(nombre, { mensual: enMensuales });
  }
}

// --- trabajos únicos (facturación) desde la hoja CAJA --------------------

const trabajos = [];
const gastos = [];
let egresosExcluidos = 0;

{
  const caja = hoja('CAJA');
  for (let i = 1; i < caja.length; i++) {
    const r = caja[i];
    const anio = r[0], mes = r[1], fechaCelda = r[2];
    const cliente = norm(r[3]);
    const desc = norm(r[4]);
    const cuotas = norm(r[5]);
    const ingreso = plata(r[6]);
    const egreso = plata(r[7]);
    const ingEze = plata(r[8]);
    const ingGer = plata(r[9]);

    if (ingreso > 0 && cliente) {
      const cCanon = registrarCliente(cliente);
      let nombre = desc || 'Cobro';
      if (cuotas && cuotas !== '1') nombre += ` (cuota ${cuotas})`;
      const totalSplit = ingEze + ingGer;
      let rg = 50, re = 50;
      if (totalSplit > 0) {
        re = Math.round((ingEze / totalSplit) * 100);
        rg = 100 - re;
      }
      trabajos.push({
        cliente: cCanon,
        nombre,
        monto: Math.round(ingreso * 100) / 100,
        fecha: fechaDe(anio, mes, fechaCelda),
        reparto_german: rg,
        reparto_ezequiel: re,
      });
    } else if (egreso < 0) {
      const monto = Math.abs(egreso);
      if (monto <= 0) continue;
      const label = cliente || 'Gasto';
      if (EGRESO_EXCLUIR.test(`${label} ${desc}`)) { egresosExcluidos++; continue; }
      const descripcion = desc ? `${label} - ${desc}` : label;
      gastos.push({
        descripcion: descripcion.slice(0, 200),
        monto: Math.round(monto * 100) / 100,
        tipo: 'unico',
        fecha: fechaDe(anio, mes, fechaCelda),
        categoria: categoriaGasto(label, desc),
      });
    }
  }
}

// --- clientes -> array final -------------------------------------------

const clientes = [...clientesMap.values()].map((c, idx) => {
  const tieneFacturacion = trabajos.some((t) => t.cliente === c.nombre);
  const notas = [];
  if (c.mensual) notas.push('Cliente con trabajo mensual según la planilla anterior. Cargá el trabajo recurrente con su monto en esta ficha.');
  return {
    nombre: c.nombre,
    color: PALETA[idx % PALETA.length],
    estado: 'activo',
    notas: notas.join(' '),
    _tieneFacturacion: tieneFacturacion,
  };
});

const salida = {
  _generado: new Date().toISOString(),
  _origen: 'anterior/TODO MARCADOR.xlsx',
  clientes: clientes.map(({ _tieneFacturacion, ...c }) => c),
  trabajos_unicos: trabajos,
  gastos,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(salida, null, 2), 'utf8');

console.log('Generado:', path.relative(process.cwd(), OUT_PATH));
console.log('  clientes:', salida.clientes.length);
console.log('  trabajos_unicos:', salida.trabajos_unicos.length,
  '| total $', salida.trabajos_unicos.reduce((a, t) => a + t.monto, 0).toLocaleString('es-AR'));
console.log('  gastos:', salida.gastos.length,
  '| total $', salida.gastos.reduce((a, g) => a + g.monto, 0).toLocaleString('es-AR'));
console.log('  egresos excluidos (honorarios/retiros):', egresosExcluidos);
const sinFact = clientes.filter((c) => !c._tieneFacturacion).map((c) => c.nombre);
console.log('  clientes sin facturación importada:', sinFact.length, sinFact.join(', '));
