-- Esquema de la base de datos de Flaks Gestión (SQLite).
-- Se ejecuta de forma idempotente al iniciar el servidor.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL,
  usuario       TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clientes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#2563eb',
  estado     TEXT NOT NULL DEFAULT 'potencial',   -- activo | potencial | inactivo (se valida en la app)
  notas      TEXT NOT NULL DEFAULT '',
  creado_en  TEXT NOT NULL DEFAULT (datetime('now')),
  creado_por TEXT
);

CREATE TABLE IF NOT EXISTS tareas (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre                TEXT NOT NULL,
  descripcion           TEXT NOT NULL DEFAULT '',
  fecha_creacion        TEXT NOT NULL DEFAULT (datetime('now')),
  prioridad             TEXT NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja','media','alta')),
  fecha_cierre          TEXT,
  cliente_id            INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  estado                TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_progreso','completada')),
  creado_por            TEXT,
  ultima_modificacion_por TEXT,
  ultima_modificacion_en  TEXT
);

CREATE TABLE IF NOT EXISTS trabajos_recurrentes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id       INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre           TEXT NOT NULL,
  monto_mensual    REAL NOT NULL DEFAULT 0,
  reparto_german   REAL NOT NULL DEFAULT 50,
  reparto_ezequiel REAL NOT NULL DEFAULT 50,
  activo           INTEGER NOT NULL DEFAULT 1,
  dia_de_cobro     INTEGER,
  creado_en        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trabajos_unicos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id       INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre           TEXT NOT NULL,
  monto            REAL NOT NULL DEFAULT 0,
  fecha            TEXT NOT NULL,
  reparto_german   REAL NOT NULL DEFAULT 50,
  reparto_ezequiel REAL NOT NULL DEFAULT 50,
  estado           TEXT NOT NULL DEFAULT 'realizado',   -- realizado | potencial (presupuesto sin confirmar)
  creado_en        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gastos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  descripcion TEXT NOT NULL,
  monto       REAL NOT NULL DEFAULT 0,
  tipo        TEXT NOT NULL DEFAULT 'unico' CHECK (tipo IN ('recurrente','unico')),
  fecha       TEXT NOT NULL,
  categoria   TEXT,
  activo      INTEGER NOT NULL DEFAULT 1,
  pagado_por  TEXT,                              -- 'German' | 'Ezequiel' | NULL
  saldado     INTEGER NOT NULL DEFAULT 1,        -- 1 = ya está saldado / pasa a Caja; 0 = va a cuenta corriente
  creado_por  TEXT,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Registro de cada vez que se salda la cuenta corriente de gastos (quién le pagó a quién).
CREATE TABLE IF NOT EXISTS saldos_gastos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  periodo        TEXT,                           -- 'YYYY-MM'
  fecha          TEXT NOT NULL DEFAULT (datetime('now')),
  de_quien       TEXT NOT NULL,                  -- quién paga la diferencia
  a_quien        TEXT NOT NULL,                  -- quién la recibe
  monto          REAL NOT NULL DEFAULT 0,
  detalle        TEXT,
  registrado_por TEXT
);

CREATE TABLE IF NOT EXISTS documentos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_original TEXT NOT NULL,
  ruta_archivo   TEXT NOT NULL,
  categoria      TEXT NOT NULL DEFAULT 'otro' CHECK (categoria IN ('presupuesto','tutorial','otro')),
  cliente_id     INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  subido_por     TEXT,
  subido_en      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario    TEXT NOT NULL,
  entidad    TEXT NOT NULL,
  entidad_id INTEGER,
  accion     TEXT NOT NULL,
  detalle    TEXT,
  fecha      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_meta (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE INDEX IF NOT EXISTS idx_tareas_cliente ON tareas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_tareas_estado ON tareas(estado);
CREATE INDEX IF NOT EXISTS idx_recurrentes_cliente ON trabajos_recurrentes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_unicos_cliente ON trabajos_unicos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_audit_entidad ON audit_log(entidad, entidad_id);
