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

  const hoyISO = new Date().toISOString().slice(0, 10);
  const recurrentes = db.prepare(`
    SELECT tr.id, tr.nombre AS concepto, tr.monto_mensual AS monto, tr.dia_de_cobro,
           tr.reparto_german, tr.reparto_ezequiel,
           c.id AS cliente_id, c.nombre AS cliente, c.logo AS cliente_logo, c.estado AS cliente_estado
    FROM trabajos_recurrentes tr
    JOIN clientes c ON c.id = tr.cliente_id
    WHERE tr.activo = 1
      AND (tr.desde IS NULL OR tr.desde <= ?)
      AND (c.estado = 'activo' OR (? = 1 AND c.estado = 'potencial'))
    ORDER BY c.nombre, tr.nombre
  `).all(prefijo, incluirPotenciales ? 1 : 0);

  // Pagos (parciales o completos) del período, agrupados por trabajo recurrente.
  const pagosPorRecurrente = {};
  db.prepare('SELECT recurrente_id, monto, fecha_pago FROM pagos_recurrentes WHERE periodo = ?').all(prefijo).forEach((p) => {
    (pagosPorRecurrente[p.recurrente_id] = pagosPorRecurrente[p.recurrente_id] || []).push(p);
  });

  // Trabajos sin cobrar (pendiente | potencial): cuentan como facturación del mes
  // de su 'fecha' (mes al que pertenecen), pero todavía no se cobraron.
  const unicos = db.prepare(`
    SELECT tu.id, tu.nombre AS concepto, tu.monto, tu.fecha,
           tu.reparto_german, tu.reparto_ezequiel, tu.estado AS trabajo_estado,
           c.id AS cliente_id, c.nombre AS cliente, c.logo AS cliente_logo, c.estado AS cliente_estado
    FROM trabajos_unicos tu
    JOIN clientes c ON c.id = tu.cliente_id
    WHERE substr(tu.fecha, 1, 7) = ?
      AND (tu.estado = 'pendiente' OR ? = 1)
    ORDER BY tu.fecha, c.nombre
  `).all(prefijo, incluirPotenciales ? 1 : 0);

  // Cobros ya realizados cuyo trabajo pertenece a este mes (fecha_trabajo), sin
  // importar en qué mes se haya cobrado realmente (fecha).
  const cobros = db.prepare(`
    SELECT co.id, co.concepto, co.monto, co.fecha_trabajo AS fecha, co.fecha AS fecha_cobro,
           co.reparto_german, co.reparto_ezequiel,
           c.id AS cliente_id, c.nombre AS cliente, c.logo AS cliente_logo, c.estado AS cliente_estado
    FROM cobros co
    JOIN clientes c ON c.id = co.cliente_id
    WHERE substr(co.fecha_trabajo, 1, 7) = ?
    ORDER BY co.fecha_trabajo, c.nombre
  `).all(prefijo);

  const esMesActual = prefijo === hoyISO.slice(0, 7);
  const mesPasado = prefijo < hoyISO.slice(0, 7);

  const filas = [];
  for (const r of recurrentes) {
    const rowPotencial = r.cliente_estado === 'potencial';
    const f = armarFila(r, 'recurrente', rowPotencial);
    const pagos = (pagosPorRecurrente[r.id] || []).slice().sort((a, b) => (a.fecha_pago < b.fecha_pago ? -1 : 1));
    f.pagos = pagos;
    f.pagado = pagos.reduce((a, p) => a + Number(p.monto || 0), 0);
    f.restante = Math.max(0, f.monto - f.pagado);
    f.cobrado = f.pagado > 0 && f.restante <= 0.005;
    f.pago_parcial = f.pagado > 0 && f.restante > 0.005;
    f.fecha_pago = pagos.length ? pagos[pagos.length - 1].fecha_pago : null;
    // pendiente/vencido mientras quede saldo (y no sea un cliente potencial / proyección)
    if (f.restante > 0.005 && !rowPotencial) {
      const venceDia = Number(r.dia_de_cobro) || null;
      const hoyDia = Number(hoyISO.slice(8, 10));
      f.pendiente = true;
      f.vencido = mesPasado || (esMesActual && venceDia && hoyDia > venceDia);
      f.vence_dia = venceDia;
    }
    filas.push(f);
  }
  for (const u of unicos) {
    const f = armarFila(u, 'unico', u.trabajo_estado === 'potencial');
    if (u.trabajo_estado === 'pendiente') f.pendiente = true;
    f.pagado = 0;
    filas.push(f);
  }
  for (const co of cobros) {
    const f = armarFila(co, 'cobro', false);
    f.cobrado = true;
    f.fecha_cobro = co.fecha_cobro;
    f.pagado = f.monto;
    filas.push(f);
  }

  const totales = filas.reduce(
    (acc, f) => {
      acc.total += f.monto;
      acc.german += f.parte_german;
      acc.ezequiel += f.parte_ezequiel;
      acc.cobrado += f.pagado;
      acc.pendiente += Math.max(0, f.monto - f.pagado);
      return acc;
    },
    { total: 0, german: 0, ezequiel: 0, pendiente: 0, cobrado: 0 }
  );

  return { filas, totales };
}

function armarFila(r, tipo, esPotencial) {
  const monto = Number(r.monto || 0);
  const pg = Number(r.reparto_german || 0);
  const pe = Number(r.reparto_ezequiel || 0);
  return {
    id: r.id,
    tipo,
    concepto: r.concepto,
    cliente: r.cliente,
    cliente_id: r.cliente_id,
    cliente_logo: r.cliente_logo,
    cliente_estado: r.cliente_estado,
    es_potencial: !!esPotencial,
    fecha: r.fecha || null,
    monto,
    reparto_german: pg,
    reparto_ezequiel: pe,
    parte_german: monto * (pg / 100),
    parte_ezequiel: monto * (pe / 100),
  };
}

const SOCIOS = ['German', 'Ezequiel'];

// Cuenta corriente de gastos: sobre un conjunto de gastos NO saldados, calcula
// cuánto puso de más cada socio y cuánto tiene que pagarle al otro para igualar.
function calcularCuentaCorriente(gastosPendientes) {
  const frente = { German: 0, Ezequiel: 0 };
  let total = 0;
  for (const g of gastosPendientes) {
    const m = Number(g.monto || 0);
    total += m;
    if (SOCIOS.includes(g.pagado_por)) frente[g.pagado_por] += m;
  }
  const baseCadaUno = total / 2;
  const balanceGerman = Math.round((frente.German - baseCadaUno) * 100) / 100; // + a favor / - en contra
  const igualado = Math.abs(balanceGerman) < 0.005;
  return {
    total,
    frenteGerman: frente.German,
    frenteEzequiel: frente.Ezequiel,
    baseCadaUno,
    balanceGerman,
    balanceEzequiel: -balanceGerman,
    igualado,
    deQuien: balanceGerman < 0 ? 'German' : 'Ezequiel',
    aQuien: balanceGerman < 0 ? 'Ezequiel' : 'German',
    montoAIgualar: Math.abs(balanceGerman),
  };
}

// Filas de gastos de un mes: recurrentes activos + únicos con fecha en el mes.
// - total / totalSaldado: lo que efectivamente pasa a Caja (sólo gastos saldados).
// - totalPendiente + cuentaCorriente: gastos sin saldar, para igualar a fin de mes.
function gastosDelMes(anio, mes) {
  const prefijo = mesPrefijo(anio, mes);

  const filas = db.prepare(`
    SELECT id, descripcion, monto, tipo, fecha, categoria, creado_por, pagado_por, saldado
    FROM gastos
    WHERE (tipo = 'recurrente' AND activo = 1)
       OR (tipo = 'unico' AND substr(fecha, 1, 7) = ?)
    ORDER BY saldado ASC, tipo DESC, fecha
  `).all(prefijo);

  let totalSaldado = 0;
  let totalPendiente = 0;
  const pendientes = [];
  for (const g of filas) {
    const m = Number(g.monto || 0);
    if (g.saldado) {
      totalSaldado += m;
    } else {
      totalPendiente += m;
      pendientes.push(g);
    }
  }

  return {
    filas,
    total: totalSaldado,
    totalSaldado,
    totalPendiente,
    cuentaCorriente: calcularCuentaCorriente(pendientes),
  };
}

// Cuenta corriente global (todos los gastos únicos sin saldar, de cualquier mes).
function cuentaCorrienteGlobal() {
  const pendientes = db.prepare(
    "SELECT monto, pagado_por, fecha FROM gastos WHERE saldado = 0 AND tipo = 'unico'"
  ).all();
  return calcularCuentaCorriente(pendientes);
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
    gastosPendientes: gastos.totalPendiente,
    netoTotal,
    netoGerman,
    netoEzequiel,
  };
}

module.exports = {
  facturacionDelMes,
  gastosDelMes,
  cajaDelMes,
  cuentaCorrienteGlobal,
  calcularCuentaCorriente,
  repartoGastosGerman,
  SOCIOS,
};
