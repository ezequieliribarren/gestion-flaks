'use strict';

// Migra (una sola vez) el viejo modelo de trabajos_unicos.estado ('realizado' |
// 'adeuda' | 'potencial') al nuevo modelo Trabajos/Cobros:
//   - 'realizado' (ya cobrado bajo el modelo viejo) -> se mueve a la tabla "cobros"
//     (no hay fecha de cobro real registrada de antes, así que se usa la misma
//     fecha del trabajo para fecha_trabajo y fecha).
//   - 'adeuda' (hecho, pendiente de cobro) -> se queda en trabajos_unicos, estado
//     renombrado a 'pendiente'.
//   - 'potencial' no se toca.
// Corre después de importarDatosIniciales() porque ahí es donde se cargan los
// trabajos_unicos históricos.

const db = require('./index');

const MARCA = 'migrar_cobros_v1';

function migrarCobros() {
  if (db.prepare('SELECT valor FROM app_meta WHERE clave = ?').get(MARCA)) return false;

  const realizados = db.prepare("SELECT * FROM trabajos_unicos WHERE estado = 'realizado'").all();
  const insCobro = db.prepare(`
    INSERT INTO cobros (cliente_id, concepto, monto, reparto_german, reparto_ezequiel, fecha_trabajo, fecha, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const delTrabajo = db.prepare('DELETE FROM trabajos_unicos WHERE id = ?');
  for (const t of realizados) {
    insCobro.run(t.cliente_id, t.nombre, t.monto, t.reparto_german, t.reparto_ezequiel, t.fecha, t.fecha, 'Migración automática');
    delTrabajo.run(t.id);
  }

  db.prepare("UPDATE trabajos_unicos SET estado = 'pendiente' WHERE estado = 'adeuda'").run();

  db.prepare('INSERT OR REPLACE INTO app_meta (clave, valor) VALUES (?, ?)').run(MARCA, new Date().toISOString());
  return true;
}

module.exports = { migrarCobros };
