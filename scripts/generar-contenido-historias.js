'use strict';

/*
 * Dev tool (no se usa en producción).
 * Lee los CSV de historias que están en anterior/ (export de Google Sheets,
 * "Archivo - Solapa.csv"), toma sólo columnas A (link) y B (producto), y arma
 * db/contenido-historias.json para importar como "links ya usados" del cliente
 * SISTEMA CONTINUO. Cada solapa = una sub-empresa.
 *
 * Uso: node scripts/generar-contenido-historias.js
 */

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const ANTERIOR = path.join(__dirname, '..', 'anterior');
const OUT = path.join(__dirname, '..', 'db', 'contenido-historias.json');
const CLIENTE = 'SISTEMA CONTINUO';
const ANIO = 2026;

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function diasEnMes(a, m) { return new Date(a, m, 0).getDate(); }

function fechaSemana(txt) {
  const m = String(txt).toLowerCase().match(/semana\s+(\d{1,2}).*?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)/);
  if (!m) return null;
  let dia = parseInt(m[1], 10);
  let mes = MESES[m[2]];
  let anio = ANIO;
  // "31 al 04 SEPTIEMBRE" => el 31 es del mes anterior
  if (dia > diasEnMes(anio, mes)) {
    mes -= 1;
    if (mes < 1) { mes = 12; anio -= 1; }
  }
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function esUrl(s) {
  return /^https?:\/\//i.test(s) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(s);
}

const archivos = fs.readdirSync(ANTERIOR).filter((f) => /historias.*\.csv$/i.test(f));
if (!archivos.length) {
  console.error('No hay CSV de historias en anterior/ (busca *historias*.csv).');
  process.exit(1);
}

const subempresas = [];
for (const archivo of archivos) {
  // "HISTORIAS JULI - Sistema Continuo.csv" -> sub-empresa = "Sistema Continuo"
  const m = archivo.replace(/\.csv$/i, '').split(' - ');
  const empresa = (m[1] || m[0]).trim();

  const wb = XLSX.readFile(path.join(ANTERIOR, archivo));
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });

  let fechaActual = null;
  const links = [];
  const vistos = new Set();
  for (const row of filas) {
    const a = String(row[0] || '').trim();
    const b = String(row[1] || '').trim();
    if (!a) continue;
    if (/^semana/i.test(a)) { fechaActual = fechaSemana(a) || fechaActual; continue; }
    if (!esUrl(a)) continue;
    const key = a.toLowerCase().replace(/\/+$/, '');
    if (vistos.has(key)) continue;
    vistos.add(key);
    links.push({ url: a, nota: b, realizado_en: fechaActual });
  }
  subempresas.push({ empresa, links });
  console.log(`${archivo}  ->  empresa "${empresa}": ${links.length} links`);
}

const salida = {
  _generado: new Date().toISOString(),
  cliente: CLIENTE,
  subempresas,
};
fs.writeFileSync(OUT, JSON.stringify(salida, null, 2), 'utf8');
console.log('Generado:', path.relative(process.cwd(), OUT));
