'use strict';

const express = require('express');
const db = require('../db');
const fmt = require('../lib/format');
const { facturacionDelMes } = require('../lib/billing');
const { cuentaCorrienteGlobal } = require('../lib/billing');
const { resumenCliente, periodoActual } = require('../lib/redes-sheet');
const { metasSemanaDe } = require('../lib/redes-metas');
const { dolarMEP, climaCaba } = require('../lib/externos');
const { TARJETAS, saludo, ocultasDe, ocultar, mostrar } = require('../lib/inicio');

const router = express.Router();

function tareasVencidas() {
  const filas = db.prepare(`
    SELECT id, nombre, fecha_cierre, estado
    FROM tareas
    WHERE fecha_cierre IS NOT NULL AND estado <> 'completada'
  `).all();
  const vencidas = filas
    .map((t) => ({ ...t, v: fmt.estadoVencimiento(t.fecha_cierre, false) }))
    .filter((t) => t.v.vencida)
    .sort((a, b) => b.v.dias - a.v.dias);
  return { total: vencidas.length, titulos: vencidas.slice(0, 6).map((t) => t.nombre) };
}

// Para cada cliente con Sheet, compara lo publicado esta semana contra su meta de
// la semana (propia o default) y arma la lista de "cuánto le falta a cada uno".
async function contenidoSemana() {
  const clientes = db.prepare(
    "SELECT * FROM clientes WHERE redes = 1 AND redes_sheet_url IS NOT NULL AND redes_sheet_url <> ''"
  ).all();
  if (!clientes.length) return { hayClientes: false };

  const periodo = periodoActual().periodo;
  const resultados = await Promise.all(clientes.map(async (c) => {
    const metas = metasSemanaDe(c.id, periodo);
    let avance;
    try { avance = await resumenCliente(c, metas); } catch (e) { avance = null; }
    if (!avance || !avance.ok) return null;
    const semAct = avance.posteos.semanas.find((s) => s.n === avance.posteos.semana_actual);
    if (!semAct) return null;
    return { cliente: c.nombre, meta: semAct.meta, hechos: semAct.cantidad, faltante: Math.max(0, semAct.meta - semAct.cantidad) };
  }));

  const validos = resultados.filter(Boolean);
  const conFaltante = validos.filter((r) => r.faltante > 0).sort((a, b) => b.faltante - a.faltante);
  const totalFaltante = conFaltante.reduce((a, r) => a + r.faltante, 0);

  return { hayClientes: true, totalClientes: clientes.length, conFaltante, totalFaltante };
}

// Trabajos únicos pendientes de cobro cuya fecha (mes al que pertenecen) es de un
// mes anterior al actual: deuda "vieja" que quedó arrastrada.
function deudaAntigua(prefijoActual) {
  const filas = db.prepare(`
    SELECT tu.id, tu.nombre AS concepto, tu.monto, tu.fecha,
           c.id AS cliente_id, c.nombre AS cliente, c.logo AS cliente_logo
    FROM trabajos_unicos tu
    JOIN clientes c ON c.id = tu.cliente_id
    WHERE tu.estado = 'pendiente' AND substr(tu.fecha, 1, 7) < ?
    ORDER BY tu.fecha ASC
  `).all(prefijoActual);
  return { total: filas.length, monto: filas.reduce((a, f) => a + f.monto, 0), filas: filas.slice(0, 8) };
}

// { anio, mes } del mes que está `delta` meses antes/después de (anio, mes).
function mesAdyacente(anio, mes, delta) {
  let m = mes + delta;
  let a = anio;
  while (m < 1) { m += 12; a -= 1; }
  while (m > 12) { m -= 12; a += 1; }
  return { anio: a, mes: m };
}

router.get('/', async (req, res) => {
  const userId = req.session.user.id;
  const ocultas = ocultasDe(userId);

  const { iso } = fmt.ahora();
  const anio = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7));
  const prefijo = iso.slice(0, 7);

  const fact = facturacionDelMes(anio, mes);
  const pendientesMes = fact.filas.filter((f) => f.pendiente).sort((a, b) => b.monto - a.monto);

  // Mes anterior: lo que realmente se facturó. Mes que viene: proyección con lo
  // único que ya se sabe hoy (recurrentes activos + trabajos/presupuestos potenciales).
  const anterior = mesAdyacente(anio, mes, -1);
  const posterior = mesAdyacente(anio, mes, 1);
  const factAnterior = facturacionDelMes(anterior.anio, anterior.mes);
  const factPosterior = facturacionDelMes(posterior.anio, posterior.mes, { incluirPotenciales: true });

  const [contenido, dolar, clima] = await Promise.all([
    contenidoSemana().catch(() => ({ hayClientes: false })),
    dolarMEP().catch(() => null),
    climaCaba().catch(() => null),
  ]);

  res.render('inicio/index', {
    titulo: 'Inicio',
    saludoTexto: saludo(req.session.user.nombre),
    ocultas,
    TARJETAS,
    tareasVencidas: tareasVencidas(),
    contenido,
    saldoSocios: cuentaCorrienteGlobal(),
    pagosPendientes: { total: pendientesMes.length, monto: pendientesMes.reduce((a, f) => a + f.monto, 0), filas: pendientesMes.slice(0, 8) },
    deudaAntigua: deudaAntigua(prefijo),
    facturadoMes: { total: fact.totales.total, pendiente: fact.totales.pendiente, cobrado: fact.totales.total - fact.totales.pendiente },
    mesAnterior: { nombre: fmt.nombreMes(anterior.mes), total: factAnterior.totales.total },
    mesPosterior: { nombre: fmt.nombreMes(posterior.mes), total: factPosterior.totales.total },
    nombreMes: fmt.nombreMes(mes),
    dolar,
    clima,
  });
});

router.post('/tarjetas/:id/ocultar', (req, res) => {
  ocultar(req.session.user.id, req.params.id);
  res.redirect('/inicio');
});

router.post('/tarjetas/:id/mostrar', (req, res) => {
  mostrar(req.session.user.id, req.params.id);
  res.redirect('/inicio');
});

module.exports = router;
