'use strict';

const db = require('../db');
const fmt = require('./format');
const { notificarAdmins } = require('./participacion');
const { resumenCliente } = require('./redes-sheet');

let ultimaRevision = 0;

function diasDelMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
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

module.exports = { revisar, revisarThrottled };
