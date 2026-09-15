'use strict';

// Lee la planificación de contenido desde el Google Sheet público de cada cliente
// (exportado como CSV, sin credenciales) y calcula el avance de publicaciones/historias
// del mes actual contra las metas del cliente.
//
// Estructura esperada del Sheet (hoja/gid=0):
//   Bloque "PUBLICACIONES": columnas IDEA | FECHA (dd/mm) | TIPO DE POSTEO | LINK
//   Bloque "HISTORIAS":     columnas FECHA (01/mm, una fila por mes) | CANTIDAD | LINK
// Se ubican las columnas buscando los encabezados "FECHA" y "CANTIDAD" en las primeras filas,
// en vez de asumir posiciones fijas, para tolerar pequeñas variaciones entre clientes.

const fmt = require('./format');

const DEFAULT_META_POSTEOS_SEM = 4;
const DEFAULT_META_HISTORIAS_MES = 15;
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map(); // sheetUrl -> { at, filas }

function idDeUrl(url) {
  const m = String(url || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

function gidDeUrl(url) {
  const m = String(url || '').match(/[?#&]gid=(\d+)/);
  return m ? m[1] : '0';
}

// Parser CSV mínimo (soporta campos entre comillas con comas/comillas escapadas).
function parseCSV(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else { enComillas = false; }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      enComillas = true;
    } else if (c === ',') {
      fila.push(campo); campo = '';
    } else if (c === '\n') {
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else if (c === '\r') {
      // ignorar
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

async function descargarFilas(sheetUrl) {
  const cached = cache.get(sheetUrl);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.filas;

  const id = idDeUrl(sheetUrl);
  if (!id) throw new Error('El link del Sheet no parece válido.');
  const gid = gidDeUrl(sheetUrl);
  const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;

  const resp = await fetch(csvUrl);
  if (!resp.ok) throw new Error('No se pudo leer el Sheet (revisá el link).');
  const texto = await resp.text();
  if (/^\s*<(!doctype|html)/i.test(texto)) {
    throw new Error('El Sheet no es público. Compartilo como "Cualquiera con el enlace puede ver".');
  }
  const filas = parseCSV(texto);
  cache.set(sheetUrl, { at: Date.now(), filas });
  return filas;
}

function norm(s) { return String(s || '').trim().toUpperCase(); }

// Busca, en las primeras filas, los encabezados FECHA (x2: publicaciones e historias) y CANTIDAD.
function ubicarColumnas(filas) {
  const maxFila = Math.min(filas.length, 6);
  for (let r = 0; r < maxFila; r++) {
    const fila = filas[r] || [];
    const fechaCols = [];
    let cantidadCol = -1;
    fila.forEach((celda, c) => {
      const v = norm(celda);
      if (v === 'FECHA') fechaCols.push(c);
      if (v === 'CANTIDAD') cantidadCol = c;
    });
    if (fechaCols.length >= 2) {
      return { headerRow: r, pubFechaCol: fechaCols[0], histFechaCol: fechaCols[1], cantidadCol };
    }
  }
  return null;
}

function diasDelMes(anio, mes) {
  return new Date(anio, mes, 0).getDate(); // mes 1-12
}

function semanaDe(dia) {
  return Math.floor((dia - 1) / 7) + 1;
}

// Parsea el JSON de metas por semana ({"1":3,"2":4,...}). Devuelve {} si no hay o es inválido.
function metasPorSemana(cliente) {
  if (!cliente || !cliente.redes_metas_posteos_sem) return {};
  try {
    const obj = JSON.parse(cliente.redes_metas_posteos_sem);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

// Meta de posteos de una semana puntual: la propia si está cargada, si no la default del cliente/global.
function metaSemana(cliente, n, metas, defaultMeta) {
  const propia = metas[String(n)];
  if (propia != null && propia !== '' && !isNaN(propia) && Number(propia) > 0) return Number(propia);
  return defaultMeta;
}

// Parsea "dd/mm" (o "dd/mm/aaaa"). Devuelve { dia, mes } o null.
function parseDiaMes(celda) {
  const m = String(celda || '').trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
  if (!m) return null;
  const dia = parseInt(m[1], 10);
  const mes = parseInt(m[2], 10);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  return { dia, mes };
}

// Calcula el resumen de avance de un cliente (mes actual) a partir de su Sheet.
// Devuelve { ok:true, posteos:{...}, historias:{...} } o { ok:false, error }.
async function resumenCliente(cliente) {
  if (!cliente || !cliente.redes_sheet_url) return null;

  const defaultMetaPosteosSem = cliente.redes_meta_posteos_sem || DEFAULT_META_POSTEOS_SEM;
  const metasPropias = metasPorSemana(cliente);
  const metaHistoriasMes = cliente.redes_meta_historias_mes || DEFAULT_META_HISTORIAS_MES;

  let filas;
  try {
    filas = await descargarFilas(cliente.redes_sheet_url);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const cols = ubicarColumnas(filas);
  if (!cols) return { ok: false, error: 'No se encontraron las columnas FECHA/CANTIDAD en el Sheet.' };

  const { iso } = fmt.ahora();
  const anio = Number(iso.slice(0, 4));
  const mesActual = Number(iso.slice(5, 7));
  const diaActual = Number(iso.slice(8, 10));

  const totalDias = diasDelMes(anio, mesActual);
  const totalSemanas = semanaDe(totalDias);
  const semanaActual = semanaDe(diaActual);

  const semanas = Array.from({ length: totalSemanas }, (_, i) => {
    const n = i + 1;
    const desde = n * 7 - 6;
    const hasta = Math.min(n * 7, totalDias);
    return { n, desde, hasta, cantidad: 0, meta: metaSemana(cliente, n, metasPropias, defaultMetaPosteosSem) };
  });

  let posteosMes = 0;
  let historiasCantidad = 0;
  let historiasFechaEncontrada = null;

  for (let r = cols.headerRow + 1; r < filas.length; r++) {
    const fila = filas[r] || [];

    const fp = parseDiaMes(fila[cols.pubFechaCol]);
    if (fp && fp.mes === mesActual) {
      posteosMes++;
      const s = semanaDe(fp.dia);
      const bucket = semanas.find((x) => x.n === s);
      if (bucket) bucket.cantidad++;
    }

    if (cols.histFechaCol != null && cols.cantidadCol >= 0) {
      const fh = parseDiaMes(fila[cols.histFechaCol]);
      // Filas "marcador de mes": día 1 (ej. 01/09) con la cantidad acumulada de ese mes.
      if (fh && fh.dia === 1 && fh.mes === mesActual) {
        const n = parseInt(String(fila[cols.cantidadCol] || '').trim(), 10);
        if (!isNaN(n)) { historiasCantidad = n; historiasFechaEncontrada = `${anio}-${String(mesActual).padStart(2, '0')}-01`; }
      }
    }
  }

  return {
    ok: true,
    actualizadoEn: Date.now(),
    posteos: {
      meta_semana_default: defaultMetaPosteosSem,
      semana_actual: semanaActual,
      semanas,
      total_mes: posteosMes,
    },
    historias: {
      meta_mes: metaHistoriasMes,
      cantidad: historiasCantidad,
      fecha: historiasFechaEncontrada,
      pct: Math.min(100, Math.round((historiasCantidad / metaHistoriasMes) * 100)),
    },
  };
}

module.exports = {
  DEFAULT_META_POSTEOS_SEM,
  DEFAULT_META_HISTORIAS_MES,
  idDeUrl,
  parseCSV,
  resumenCliente,
};
