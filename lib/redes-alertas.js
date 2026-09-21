'use strict';

const db = require('../db');
const fmt = require('./format');
const { notificarAdmins } = require('./participacion');
const { resumenCliente } = require('./redes-sheet');

let ultimaRevision = 0;
let ultimaRevisionPublicaciones = 0;

function diasDelMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
}

// Misma noción de "semana" que usa lib/redes-sheet.js (bloques de 7 días del mes, no Lu-Do reales).
function semanaDe(dia) {
  return Math.floor((dia - 1) / 7) + 1;
}

// Si a una semana o menos de terminar el mes un cliente va debajo de la meta de
// historias, avisa una vez por cliente/mes a los admin. Idempotente vía redes_alertas.
async function revisar() {
  const { iso } = fmt.ahora();
  const anio = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7));
  const dia = Number(iso.slice(8, 10));
  const periodo = `${anio}-${String(mes).padStart(2, '0')}`;
  const diasRestantes = diasDelMes(anio, mes) - dia;
  if (diasRestantes > 7) return 0;

  const clientes = db.prepare("SELECT * FROM clientes WHERE redes = 1 AND redes_sheet_url IS NOT NULL AND redes_sheet_url <> ''").all();
  let avisos = 0;

  for (const c of clientes) {
    const yaAvisado = db.prepare(
      "SELECT 1 FROM redes_alertas WHERE cliente_id = ? AND periodo = ? AND tipo = 'historias_bajas'"
    ).get(c.id, periodo);
    if (yaAvisado) continue;

    let resumen;
    try {
      resumen = await resumenCliente(c);
    } catch (e) {
      continue;
    }
    if (!resumen || !resumen.ok) continue;

    if (resumen.historias.cantidad < resumen.historias.meta_mes) {
      const falta = resumen.historias.meta_mes - resumen.historias.cantidad;
      notificarAdmins(
        'redes_historias',
        c.id,
        `${c.nombre}: quedan ${diasRestantes} día(s) del mes y faltan ${falta} historia(s) para llegar a la meta (${resumen.historias.cantidad}/${resumen.historias.meta_mes}).`,
        '/contenido/' + c.id,
        null
      );
      db.prepare("INSERT OR IGNORE INTO redes_alertas (cliente_id, periodo, tipo) VALUES (?, ?, 'historias_bajas')").run(c.id, periodo);
      avisos++;
    }
  }
  return avisos;
}

// Versión "barata" para el middleware: revisa como máximo cada 1 hora
// (hace fetch a Sheets externos, no conviene en cada request).
function revisarThrottled() {
  const ahora = Date.now();
  if (ahora - ultimaRevision < 60 * 60 * 1000) return;
  ultimaRevision = ahora;
  revisar().catch((e) => console.error('revisar alertas de redes:', e.message));
}

// Cada lunes, por cada cliente de Contenido, si la semana que terminó ayer se quedó
// corta de publicaciones (posteos) contra su meta, crea una tarea de contenido
// "Publicación - <cliente>" como recordatorio/verificación y avisa a los admin.
// Idempotente vía redes_alertas (una sola vez por cliente/semana, no se duplica si
// el server reinicia varias veces el mismo lunes).
async function revisarPublicacionesSemana() {
  const { iso } = fmt.ahora();
  const anio = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7));
  const dia = Number(iso.slice(8, 10));
  if (new Date(anio, mes - 1, dia).getDay() !== 1) return 0; // solo lunes
  if (dia <= 1) return 0; // el 1° del mes no tiene una semana anterior dentro de este mismo mes

  const semanaPasada = semanaDe(dia - 1);
  const periodo = `${anio}-${String(mes).padStart(2, '0')}`;
  const marca = `publicaciones_semana_${semanaPasada}`;

  const clientes = db.prepare("SELECT * FROM clientes WHERE redes = 1 AND redes_sheet_url IS NOT NULL AND redes_sheet_url <> ''").all();
  let creadas = 0;

  for (const c of clientes) {
    const yaRevisado = db.prepare(
      'SELECT 1 FROM redes_alertas WHERE cliente_id = ? AND periodo = ? AND tipo = ?'
    ).get(c.id, periodo, marca);
    if (yaRevisado) continue;

    let resumen;
    try {
      resumen = await resumenCliente(c);
    } catch (e) {
      continue;
    }
    if (!resumen || !resumen.ok) continue;

    const semana = resumen.posteos.semanas.find((s) => s.n === semanaPasada);
    db.prepare('INSERT OR IGNORE INTO redes_alertas (cliente_id, periodo, tipo) VALUES (?, ?, ?)').run(c.id, periodo, marca);
    if (!semana || semana.cantidad >= semana.meta) continue;

    const falta = semana.meta - semana.cantidad;
    const titulo = `Publicación - ${c.nombre}`;
    const info = db.prepare(`
      INSERT INTO tareas_contenido (cliente_id, tipo, titulo, descripcion, creado_por, ultima_modificacion_por, ultima_modificacion_en)
      VALUES (?, 'posteos', ?, ?, 'Sistema', 'Sistema', datetime('now'))
    `).run(
      c.id,
      titulo,
      `Verificación automática: la semana del ${semana.desde}/${mes} al ${semana.hasta}/${mes} quedó en ${semana.cantidad}/${semana.meta} publicaciones. Revisar y completar lo que falte.`
    );
    notificarAdmins(
      'redes_publicaciones',
      c.id,
      `${c.nombre}: faltaron ${falta} publicación(es) la semana pasada (${semana.cantidad}/${semana.meta}). Se creó una tarea de verificación.`,
      '/contenido/' + c.id + '/tareas/' + info.lastInsertRowid,
      null
    );
    creadas++;
  }
  return creadas;
}

// Versión "barata" para el middleware: revisa como máximo cada 1 hora.
function revisarPublicacionesSemanaThrottled() {
  const ahora = Date.now();
  if (ahora - ultimaRevisionPublicaciones < 60 * 60 * 1000) return;
  ultimaRevisionPublicaciones = ahora;
  revisarPublicacionesSemana().catch((e) => console.error('revisar publicaciones de la semana:', e.message));
}

module.exports = { revisar, revisarThrottled, revisarPublicacionesSemana, revisarPublicacionesSemanaThrottled };
