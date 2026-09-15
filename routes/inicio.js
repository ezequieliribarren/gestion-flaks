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

router.get('/', async (req, res) => {
  const userId = req.session.user.id;
  const ocultas = ocultasDe(userId);

  const { iso } = fmt.ahora();
  const anio = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7));

  const fact = facturacionDelMes(anio, mes);
  const pendientes = fact.filas.filter((f) => f.pendiente);

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
    pagosPendientes: { total: pendientes.length, monto: pendientes.reduce((a, f) => a + f.monto, 0), filas: pendientes.slice(0, 6) },
    facturadoMes: fact.totales.total,
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
