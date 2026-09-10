'use strict';

const path = require('path');
const fs = require('fs');
const { Database } = require('node-sqlite3-wasm');
const { DATA_DIR, DB_PATH } = require('../lib/paths');

// Usamos node-sqlite3-wasm (SQLite compilado a WebAssembly): API síncrona, sin
// compilación nativa ni node-gyp — funciona en cualquier hosting compartido.
// La ubicación de la base la define lib/paths.js (env FLAKS_DATA_DIR o ./data).
const LOCK_DIR = DB_PATH + '.lock';

// El VFS de node-sqlite3-wasm usa una carpeta ".lock" mientras escribe. Si un
// reinicio brusco dejó una obsoleta, la limpiamos al arrancar (proceso único).
try {
  if (fs.existsSync(LOCK_DIR)) fs.rmdirSync(LOCK_DIR);
} catch (e) {
  /* noop */
}

const raw = new Database(DB_PATH);
raw.exec('PRAGMA foreign_keys = ON');

// Esquema (idempotente).
raw.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// Migraciones sobre bases ya creadas (cambios que schema.sql no aplica solo).
(function migrar() {
  const colsGastos = raw.all('PRAGMA table_info(gastos)').map((c) => c.name);
  if (!colsGastos.includes('pagado_por')) {
    raw.exec('ALTER TABLE gastos ADD COLUMN pagado_por TEXT');
  }
  if (!colsGastos.includes('saldado')) {
    raw.exec('ALTER TABLE gastos ADD COLUMN saldado INTEGER NOT NULL DEFAULT 1');
  }

  const colsUnicos = raw.all('PRAGMA table_info(trabajos_unicos)').map((c) => c.name);
  if (!colsUnicos.includes('estado')) {
    raw.exec("ALTER TABLE trabajos_unicos ADD COLUMN estado TEXT NOT NULL DEFAULT 'realizado'");
  }

  // clientes.estado tenía un CHECK que no permitía 'inactivo' → reconstruir la tabla.
  const clientesTabla = raw.all(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='clientes'"
  )[0];
  if (clientesTabla && /CHECK\s*\(\s*estado/i.test(clientesTabla.sql)) {
    try {
      raw.exec('PRAGMA foreign_keys = OFF');
      raw.exec("CREATE TABLE clientes_new (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#2563eb', logo TEXT, estado TEXT NOT NULL DEFAULT 'potencial', notas TEXT NOT NULL DEFAULT '', creado_en TEXT NOT NULL DEFAULT (datetime('now')), creado_por TEXT)");
      raw.exec(
        'INSERT INTO clientes_new (id, nombre, color, estado, notas, creado_en, creado_por) ' +
        "SELECT id, nombre, COALESCE(color,'#2563eb'), COALESCE(estado,'potencial'), " +
        "COALESCE(notas,''), COALESCE(creado_en, datetime('now')), creado_por FROM clientes"
      );
      raw.exec('DROP TABLE clientes');
      raw.exec('ALTER TABLE clientes_new RENAME TO clientes');
      raw.exec('PRAGMA foreign_keys = ON');
      console.log('Migración: clientes.estado ahora admite "inactivo".');
    } catch (err) {
      console.error('Fallo la migración de clientes.estado:', err.message);
      try { raw.exec('DROP TABLE IF EXISTS clientes_new'); } catch (e) { /* noop */ }
      try { raw.exec('PRAGMA foreign_keys = ON'); } catch (e) { /* noop */ }
    }
  }

  const colsClientes = raw.all('PRAGMA table_info(clientes)').map((c) => c.name);
  if (!colsClientes.includes('logo')) raw.exec('ALTER TABLE clientes ADD COLUMN logo TEXT');
  if (!colsClientes.includes('redes')) raw.exec('ALTER TABLE clientes ADD COLUMN redes INTEGER NOT NULL DEFAULT 0');
  if (!colsClientes.includes('redes_plan')) raw.exec('ALTER TABLE clientes ADD COLUMN redes_plan TEXT');
  if (!colsClientes.includes('redes_sheet_url')) raw.exec('ALTER TABLE clientes ADD COLUMN redes_sheet_url TEXT');
  if (!colsClientes.includes('marketing_excluido')) raw.exec('ALTER TABLE clientes ADD COLUMN marketing_excluido INTEGER NOT NULL DEFAULT 0');

  const colsUsers = raw.all('PRAGMA table_info(users)').map((c) => c.name);
  if (!colsUsers.includes('rol')) raw.exec("ALTER TABLE users ADD COLUMN rol TEXT NOT NULL DEFAULT 'admin'");

  const colsTareas = raw.all('PRAGMA table_info(tareas)').map((c) => c.name);
  if (!colsTareas.includes('interna')) raw.exec('ALTER TABLE tareas ADD COLUMN interna INTEGER NOT NULL DEFAULT 0');
  if (!colsTareas.includes('links')) raw.exec("ALTER TABLE tareas ADD COLUMN links TEXT NOT NULL DEFAULT ''");

  const tieneLinks = raw.all("SELECT name FROM sqlite_master WHERE type='table' AND name='contenido_links'").length;
  if (tieneLinks) {
    const colsLinks = raw.all('PRAGMA table_info(contenido_links)').map((c) => c.name);
    if (!colsLinks.includes('empresa')) raw.exec("ALTER TABLE contenido_links ADD COLUMN empresa TEXT NOT NULL DEFAULT ''");
  }
})();

// --- Adaptador con la interfaz de better-sqlite3 que usa el resto del código ---

function esObjetoDeParametros(v) {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !(v instanceof Uint8Array) &&
    !Buffer.isBuffer(v)
  );
}

function normalizar(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

function nombresDeParametros(sql) {
  const set = new Set();
  const re = /[@:$]([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m;
  while ((m = re.exec(sql))) set.add(m[1]);
  return set;
}

// Convierte los argumentos estilo better-sqlite3 (variádicos u objeto) al
// formato de node-sqlite3-wasm (array u objeto con claves prefijadas por '@').
function armarBind(sql, args) {
  if (!args.length) return undefined;
  if (args.length === 1 && esObjetoDeParametros(args[0])) {
    const claves = nombresDeParametros(sql);
    const out = {};
    for (const k of Object.keys(args[0])) {
      if (claves.has(k)) out['@' + k] = normalizar(args[0][k]);
    }
    return out;
  }
  return args.map(normalizar);
}

function prepare(sql) {
  return {
    get(...args) {
      const st = raw.prepare(sql);
      try {
        const bind = armarBind(sql, args);
        const row = bind === undefined ? st.get() : st.get(bind);
        return row == null ? undefined : row;
      } finally {
        st.finalize();
      }
    },
    all(...args) {
      const st = raw.prepare(sql);
      try {
        const bind = armarBind(sql, args);
        return bind === undefined ? st.all() : st.all(bind);
      } finally {
        st.finalize();
      }
    },
    run(...args) {
      const bind = armarBind(sql, args);
      return bind === undefined ? raw.run(sql) : raw.run(sql, bind);
    },
  };
}

const db = {
  prepare,
  exec: (sql) => raw.exec(sql),
  pragma: (expr) => raw.exec('PRAGMA ' + expr),
  transaction(fn) {
    return (...args) => {
      raw.exec('BEGIN');
      try {
        const r = fn(...args);
        raw.exec('COMMIT');
        return r;
      } catch (err) {
        try { raw.exec('ROLLBACK'); } catch (e) { /* noop */ }
        throw err;
      }
    };
  },
  DATA_DIR,
  DB_PATH,
};

function cerrar() {
  try { raw.close(); } catch (e) { /* noop */ }
}
process.on('exit', cerrar);
process.on('SIGINT', () => { cerrar(); process.exit(0); });
process.on('SIGTERM', () => { cerrar(); process.exit(0); });

module.exports = db;
