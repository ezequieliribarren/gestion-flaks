'use strict';

const express = require('express');
const db = require('../db');
const fmt = require('../lib/format');
const { facturacionDelMes, gastosDelMes } = require('../lib/billing');
const { cuentaCorrienteGlobal } = require('../lib/billing');
const { resumenCliente, periodoActual } = require('../lib/redes-sheet');
const { metasSemanaDe } = require('../lib/redes-metas');
const { dolarMEP, climaCaba } = require('../lib/externos');
const { TARJETAS, saludo, ocultasDe, ocultar, mostrar } = require('../lib/inicio');
const { objetivosVigentes } = require('../lib/objetivos');

const router = express.Router();

// Cuánto de la facturación del mes es de trabajos recurrentes (mensuales, monto fijo)
// vs. trabajos únicos (puntuales de ese mes, ya cobrados o no) — para ver de un
// vistazo qué parte del total es "base estable" y qué parte es nuevo ese mes.
function desglosePorTipo(filas) {
  const suma = (tipos) => filas.filter((f) => tipos.includes(f.tipo)).reduce((a, f) => a + f.monto, 0);
  return { recurrentes: suma(['recurrente']), unicos: suma(['unico', 'cobro']) };
}

// Gasto del mes en publicidad (Meta Ads, Google Ads, pauta en general). La categoría
// es un campo de texto libre (no un menú fijo), así que no alcanza con buscar
// "Publicidad" exacto: matchea por categoría O por palabras clave en la descripción,
// sin importar mayúsculas/minúsculas.
const RE_PUBLICIDAD = /public|\bpauta\b|meta\s*ads|google\s*ads|facebook\s*ads|instagram\s*ads|tiktok\s*ads/i;
function esGastoPublicidad(g) {
  return RE_PUBLICIDAD.test(g.categoria || '') || RE_PUBLICIDAD.test(g.descripcion || '');
}
function gastoPublicidad(anio, mes) {
  const pub = gastosDelMes(anio, mes).filas.filter(esGastoPublicidad);
  return { total: pub.reduce((a, g) => a + Number(g.monto || 0), 0), cantidad: pub.length };
}

// Retorno de los clientes nuevos del mes, para comparar contra el gasto en publicidad:
// cuántos presupuestos ya confirmaron (trabajos_unicos no potenciales) y cuánto
// generaron en total (confirmado + ya cobrado).
// "Nuevo" se define por su primera actividad real (primer trabajo/cobro/recurrente),
// no por clientes.creado_en: los clientes importados de la planilla histórica quedaron
// con esa fecha en el momento de la importación, no la fecha real en que se sumaron.
function retornoClientesNuevos(anio, mes) {
  const prefijo = `${anio}-${String(mes).padStart(2, '0')}`;
  const primeraActividad = db.prepare(`
    SELECT cliente_id, MIN(fecha) AS primera FROM (
      SELECT cliente_id, fecha FROM trabajos_unicos
      UNION ALL
      SELECT cliente_id, fecha_trabajo AS fecha FROM cobros
      UNION ALL
      SELECT cliente_id, substr(creado_en, 1, 10) AS fecha FROM trabajos_recurrentes
    )
    GROUP BY cliente_id
  `).all();
  const idsNuevos = primeraActividad.filter((r) => String(r.primera).slice(0, 7) === prefijo).map((r) => r.cliente_id);
  if (!idsNuevos.length) return { clientesNuevos: 0, presupuestosConfirmados: 0, retorno: 0 };

  const placeholders = idsNuevos.map(() => '?').join(',');
  const confirmados = db.prepare(`SELECT monto FROM trabajos_unicos WHERE estado = 'pendiente' AND cliente_id IN (${placeholders})`).all(...idsNuevos);
  const cobrados = db.prepare(`SELECT monto FROM cobros WHERE cliente_id IN (${placeholders})`).all(...idsNuevos);

  const retorno = confirmados.reduce((a, t) => a + Number(t.monto || 0), 0) + cobrados.reduce((a, c) => a + Number(c.monto || 0), 0);
  return { clientesNuevos: idsNuevos.length, presupuestosConfirmados: confirmados.length, retorno };
}

// Slide de la tarjeta de publicidad para un mes puntual (gasto + retorno de clientes nuevos).
function tarjetaPublicidadDe(anio, mes) {
  return { nombre: fmt.nombreMes(mes), ...gastoPublicidad(anio, mes), ...retornoClientesNuevos(anio, mes) };
}

// Total facturado a un cliente "raíz" + sus hijos de grupo (ej. SISTEMA CONTINUO,
// que agrupa a SENKO/ARTANIUM/SISTEMA CONTINUO GF y se les cobra distinto cada mes).
function totalGrupo(filas, nombreRaiz) {
  const raiz = db.prepare('SELECT id FROM clientes WHERE nombre = ?').get(nombreRaiz);
  if (!raiz) return null;
  const miembros = new Set(
    db.prepare('SELECT id FROM clientes WHERE id = ? OR grupo_id = ?').all(raiz.id, raiz.id).map((r) => r.id)
  );
  return filas.filter((f) => miembros.has(f.cliente_id)).reduce((a, f) => a + f.monto, 0);
}

// Tareas "Renovar…" generadas por vencimientos (clientes o internos de Flaks) que
// todavía están abiertas, para mostrarlas juntas en Inicio sin importar de dónde salieron.
function vencimientosImportantes() {
  const filas = db.prepare(`
    SELECT t.id, t.nombre, t.fecha_cierre, t.cliente_id, c.nombre AS cliente_nombre
    FROM tareas t LEFT JOIN clientes c ON c.id = t.cliente_id
    WHERE t.origen = 'vencimiento' AND t.estado <> 'completada'
    ORDER BY t.fecha_cierre
  `).all();
  return { total: filas.length, filas: filas.slice(0, 3) };
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
  return { total: vencidas.length, titulos: vencidas.slice(0, 3).map((t) => t.nombre) };
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
  return { total: filas.length, monto: filas.reduce((a, f) => a + f.monto, 0), filas: filas.slice(0, 3) };
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
  const dosAtras = mesAdyacente(anio, mes, -2);
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
    vencimientosImportantes: vencimientosImportantes(),
    contenido,
    saldoSocios: cuentaCorrienteGlobal(),
    pagosPendientes: { total: pendientesMes.length, monto: pendientesMes.reduce((a, f) => a + f.monto, 0), filas: pendientesMes.slice(0, 3) },
    deudaAntigua: deudaAntigua(prefijo),
    facturadoMes: {
      total: fact.totales.total,
      pendiente: fact.totales.pendiente,
      cobrado: fact.totales.total - fact.totales.pendiente,
      ...desglosePorTipo(fact.filas),
      sistemaContinuo: totalGrupo(fact.filas, 'SISTEMA CONTINUO'),
      sistemaContinuoAnterior: totalGrupo(factAnterior.filas, 'SISTEMA CONTINUO'),
    },
    mesAnterior: { nombre: fmt.nombreMes(anterior.mes), total: factAnterior.totales.total, ...desglosePorTipo(factAnterior.filas) },
    mesPosterior: { nombre: fmt.nombreMes(posterior.mes), total: factPosterior.totales.total, ...desglosePorTipo(factPosterior.filas) },
    gastoPublicidadSlides: [
      tarjetaPublicidadDe(dosAtras.anio, dosAtras.mes),
      tarjetaPublicidadDe(anterior.anio, anterior.mes),
      tarjetaPublicidadDe(anio, mes),
    ],
    objetivos: objetivosVigentes(),
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
