'use strict';

const express = require('express');
const db = require('../db');
const fmt = require('../lib/format');
const { facturacionDelMes } = require('../lib/billing');
const { cuentaCorrienteGlobal } = require('../lib/billing');
const { diasPublicadosSemanaActual } = require('../lib/redes-sheet');
const { dolarMEP, climaCaba } = require('../lib/externos');
const { TARJETAS, saludo, ocultasDe, ocultar, mostrar } = require('../lib/inicio');

const router = express.Router();

const DIAS_SEMANA = [null, 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

function isoWeekday(iso) {
  const d = new Date(iso + 'T00:00:00');
  const w = d.getDay();
  return w === 0 ? 7 : w;
}

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

async function contenidoSemana() {
  const clientes = db.prepare(
    "SELECT * FROM clientes WHERE redes = 1 AND redes_sheet_url IS NOT NULL AND redes_sheet_url <> ''"
  ).all();
  if (!clientes.length) return { hayClientes: false };

  const porCliente = await Promise.all(clientes.map((c) => diasPublicadosSemanaActual(c)));
  const hoyIso = isoWeekday(fmt.ahora().iso);

  const dias = [1, 2, 3, 4, 5].map((n) => {
    const conPosteo = porCliente.filter((set) => set.has(n)).length;
    let estado;
    if (n > hoyIso) estado = 'pendiente';
    else if (conPosteo === 0) estado = 'faltante';
    else if (conPosteo < clientes.length) estado = 'parcial';
    else estado = 'completo';
    return { n, nombre: DIAS_SEMANA[n], conPosteo, estado };
  });

  const faltantes = dias.filter((d) => d.estado === 'faltante' || d.estado === 'parcial');
  return { hayClientes: true, totalClientes: clientes.length, dias, hoyIso, faltantes };
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
