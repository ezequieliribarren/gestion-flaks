'use strict';

const db = require('../db');

function mesPrefijo(anio, mes) {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

// Porcentaje de gastos que carga German (el resto lo carga Ezequiel).
function repartoGastosGerman() {
  const v = parseFloat(process.env.GASTOS_REPARTO_GERMAN);
  if (isNaN(v) || v < 0 || v > 100) return 50;
  return v;
}

// Filas de facturación de un mes.
// opts.incluirPotenciales: si es true, incluye trabajos recurrentes de clientes 'potencial'.
function facturacionDelMes(anio, mes, opts = {}) {
  const prefijo = mesPrefijo(anio, mes);
  const incluirPotenciales = !!opts.incluirPotenciales;

  const recurrentes = db.prepare(`
    SELECT tr.id, tr.nombre AS concepto, tr.monto_mensual AS monto,
           tr.reparto_german, tr.reparto_ezequiel,
           c.id AS cliente_id, c.nombre AS cliente, c.color AS cliente_color, c.estado AS cliente_estado
    FROM trabajos_recurrentes tr
    JOIN clientes c ON c.id = tr.cliente_id
    WHERE tr.activo = 1
      AND (? = 1 OR c.estado = 'activo')
    ORDER BY c.nombre, tr.nombre
  `).all(incluirPotenciales ? 1 : 0);

  const unicos = db.prepare(`
    SELECT tu.id, tu.nombre AS concepto, tu.monto, tu.fecha,
           tu.reparto_german, tu.reparto_ezequiel,
           c.id AS cliente_id, c.nombre AS cliente, c.color AS cliente_color, c.estado AS cliente_estado
    FROM trabajos_unicos tu
    JOIN clientes c ON c.id = tu.cliente_id
    WHERE substr(tu.fecha, 1, 7) = ?
      AND (? = 1 OR c.estado = 'activo')
    ORDER BY tu.fecha, c.nombre
  `).all(prefijo, incluirPotenciales ? 1 : 0);

  const filas = [];
  for (const r of recurrentes) {
    filas.push(armarFila(r, 'recurrente'));
  }
  for (const u of unicos) {
    filas.push(armarFila(u, 'unico'));
  }

  const totales = filas.reduce(
    (acc, f) => {
      acc.total += f.monto;
      acc.german += f.parte_german;
      acc.ezequiel += f.parte_ezequiel;
      return acc;
    },
    { total: 0, german: 0, ezequiel: 0 }
  );

  return { filas, totales };
}

function armarFila(r, tipo) {
  const monto = Number(r.monto || 0);
  const pg = Number(r.reparto_german || 0);
  const pe = Number(r.reparto_ezequiel || 0);
  return {
    tipo,
    concepto: r.concepto,
    cliente: r.cliente,
    cliente_id: r.cliente_id,
    cliente_color: r.cliente_color,
    cliente_estado: r.cliente_estado,
    fecha: r.fecha || null,
    monto,
    reparto_german: pg,
    reparto_ezequiel: pe,
    parte_german: monto * (pg / 100),
    parte_ezequiel: monto * (pe / 100),
  };
}

// Filas de gastos de un mes: recurrentes activos + únicos con fecha en el mes.
function gastosDelMes(anio, mes) {
  const prefijo = mesPrefijo(anio, mes);

  const filas = db.prepare(`
    SELECT id, descripcion, monto, tipo, fecha, categoria, creado_por
    FROM gastos
    WHERE (tipo = 'recurrente' AND activo = 1)
       OR (tipo = 'unico' AND substr(fecha, 1, 7) = ?)
    ORDER BY tipo DESC, fecha
  `).all(prefijo);

  const total = filas.reduce((acc, g) => acc + Number(g.monto || 0), 0);
  return { filas, total };
}

// Caja consolidada del mes.
function cajaDelMes(anio, mes, opts = {}) {
  const fact = facturacionDelMes(anio, mes, opts);
  const gastos = gastosDelMes(anio, mes);

  const pg = repartoGastosGerman() / 100;
  const gastosGerman = gastos.total * pg;
  const gastosEzequiel = gastos.total * (1 - pg);

  const netoTotal = fact.totales.total - gastos.total;
  const netoGerman = fact.totales.german - gastosGerman;
  const netoEzequiel = fact.totales.ezequiel - gastosEzequiel;

  return {
    facturacion: fact,
    gastos,
    repartoGastosGermanPct: repartoGastosGerman(),
    gastosGerman,
    gastosEzequiel,
    netoTotal,
    netoGerman,
    netoEzequiel,
  };
}

module.exports = {
  facturacionDelMes,
  gastosDelMes,
  cajaDelMes,
  repartoGastosGerman,
};
