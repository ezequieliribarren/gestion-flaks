'use strict';

/*
 * Importa "db/datos-iniciales.json" (generado desde la planilla anterior) al
 * dashboard: clientes, trabajos únicos (facturación) y gastos.
 *
 * - Idempotente: deja una marca en app_meta y no vuelve a importar.
 * - Se ejecuta solo al arrancar el server (server.js).
 * - Manual:  npm run import           -> importa si no se hizo
 *            npm run import -- --reset -> borra lo importado y vuelve a importar
 *
 * Todo lo importado queda con creado_por = 'import-xlsx', así que borrar o
 * editar estos registros a mano no afecta a los cargados por German/Ezequiel.
 */

const path = require('path');
const fs = require('fs');
const db = require('./index');

const MARCA = 'import_datos_iniciales_v1';
const JSON_PATH = path.join(__dirname, 'datos-iniciales.json');
const ORIGEN = 'import-xlsx';

function yaImportado() {
  const row = db.prepare('SELECT valor FROM app_meta WHERE clave = ?').get(MARCA);
  return !!row;
}

function limpiarImportado(log) {
  const c = db.prepare("DELETE FROM clientes WHERE creado_por = ?").run(ORIGEN);
  const g = db.prepare("DELETE FROM gastos WHERE creado_por = ?").run(ORIGEN);
  db.prepare('DELETE FROM app_meta WHERE clave = ?').run(MARCA);
  log(`  Borrados: ${c.changes} clientes (con sus trabajos) y ${g.changes} gastos importados.`);
}

function importarDatosIniciales(log = console.log, { reset = false } = {}) {
  if (!fs.existsSync(JSON_PATH)) return false;

  if (reset) {
    log('--- Reimportando datos iniciales (--reset) ---');
    limpiarImportado(log);
  } else if (yaImportado()) {
    return false;
  } else {
    log('--- Importando datos iniciales desde la planilla anterior ---');
  }

  const datos = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const clientes = datos.clientes || [];
  const trabajos = datos.trabajos_unicos || [];
  const gastos = datos.gastos || [];

  const insCliente = db.prepare(
    "INSERT INTO clientes (nombre, color, estado, notas, creado_por) VALUES (@nombre, @color, @estado, @notas, 'import-xlsx')"
  );
  const insTrabajo = db.prepare(
    'INSERT INTO trabajos_unicos (cliente_id, nombre, monto, fecha, reparto_german, reparto_ezequiel) VALUES (@cliente_id, @nombre, @monto, @fecha, @rg, @re)'
  );
  const insGasto = db.prepare(
    "INSERT INTO gastos (descripcion, monto, tipo, fecha, categoria, creado_por) VALUES (@descripcion, @monto, @tipo, @fecha, @categoria, 'import-xlsx')"
  );

  const correr = db.transaction(() => {
    const idPorNombre = new Map();

    // Clientes ya existentes (cargados a mano): se respetan, no se duplican.
    for (const row of db.prepare('SELECT id, nombre FROM clientes').all()) {
      idPorNombre.set(row.nombre.toLowerCase(), row.id);
    }

    let nc = 0;
    for (const c of clientes) {
      const key = c.nombre.toLowerCase();
      if (idPorNombre.has(key)) continue;
      const info = insCliente.run({
        nombre: c.nombre,
        color: c.color || '#2563eb',
        estado: c.estado === 'potencial' ? 'potencial' : 'activo',
        notas: c.notas || '',
      });
      idPorNombre.set(key, info.lastInsertRowid);
      nc++;
    }

    let nt = 0;
    for (const t of trabajos) {
      const cid = idPorNombre.get(String(t.cliente).toLowerCase());
      if (!cid) continue;
      insTrabajo.run({
        cliente_id: cid,
        nombre: t.nombre || 'Cobro',
        monto: Number(t.monto) || 0,
        fecha: t.fecha,
        rg: Number(t.reparto_german) || 0,
        re: Number(t.reparto_ezequiel) || 0,
      });
      nt++;
    }

    let ng = 0;
    for (const g of gastos) {
      insGasto.run({
        descripcion: g.descripcion || 'Gasto',
        monto: Number(g.monto) || 0,
        tipo: g.tipo === 'recurrente' ? 'recurrente' : 'unico',
        fecha: g.fecha,
        categoria: g.categoria || null,
      });
      ng++;
    }

    db.prepare('INSERT OR REPLACE INTO app_meta (clave, valor) VALUES (?, ?)')
      .run(MARCA, new Date().toISOString());

    return { nc, nt, ng };
  });

  const { nc, nt, ng } = correr();
  log(`  Importados: ${nc} clientes nuevos, ${nt} trabajos de facturación, ${ng} gastos.`);
  log('-------------------------------------------------------------');
  return true;
}

module.exports = { importarDatosIniciales };

// Ejecución directa: npm run import  [-- --reset]
if (require.main === module) {
  const reset = process.argv.includes('--reset');
  const hizo = importarDatosIniciales(console.log, { reset });
  if (!hizo && !reset) console.log('Los datos iniciales ya estaban importados (usá "-- --reset" para rehacerlo).');
}
