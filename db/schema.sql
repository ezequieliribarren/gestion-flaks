-- Esquema de la base de datos de Flaks Gestión (SQLite).
-- Se ejecuta de forma idempotente al iniciar el servidor.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL,
  usuario       TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'admin',    -- admin (acceso total) | contenido (solo el módulo Contenido)
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clientes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#2563eb',     -- en desuso (se dejó por compatibilidad)
  logo       TEXT,                                -- ruta relativa dentro de storage/ (uploads/logos/...)
  estado     TEXT NOT NULL DEFAULT 'potencial',   -- activo | potencial | inactivo (se valida en la app)
  notas      TEXT NOT NULL DEFAULT '',
  redes           INTEGER NOT NULL DEFAULT 0,     -- 1 = tiene redes sociales / contenido como servicio
  redes_plan      TEXT,                           -- ej. "Plan 1", "Plan 2", "A medida"
  redes_sheet_url TEXT,                           -- link al Google Sheet de planificación de contenido
  creado_en  TEXT NOT NULL DEFAULT (datetime('now')),
  creado_por TEXT
);

-- Tareas de contenido (redes): historias, reels, posteos, etc. por cliente.
CREATE TABLE IF NOT EXISTS tareas_contenido (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id     INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL DEFAULT 'historias',   -- historias | reels | posteos | carrusel | otro
  titulo         TEXT NOT NULL,
  descripcion    TEXT NOT NULL DEFAULT '',
  estado         TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | en_progreso | completada
  fecha_objetivo TEXT,
  creado_por     TEXT,
  creado_en      TEXT NOT NULL DEFAULT (datetime('now')),
  ultima_modificacion_por TEXT,
  ultima_modificacion_en  TEXT
);

-- Links (productos de contenido) de una tarea de contenido, con control de "ya usado".
CREATE TABLE IF NOT EXISTS contenido_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id     INTEGER NOT NULL REFERENCES tareas_contenido(id) ON DELETE CASCADE,
  cliente_id   INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  url_norm     TEXT NOT NULL,                     -- versión normalizada para detectar repetidos
  empresa      TEXT NOT NULL DEFAULT '',          -- sub-marca / local del cliente
  realizado    INTEGER NOT NULL DEFAULT 0,
  realizado_en TEXT,                              -- fecha en que se marcó como usado/realizado
  nota         TEXT NOT NULL DEFAULT '',
  creado_por   TEXT,
  creado_en    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tareas (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre                TEXT NOT NULL,
  descripcion           TEXT NOT NULL DEFAULT '',   -- "Desarrollo" en la interfaz
  links                 TEXT NOT NULL DEFAULT '',   -- links de la tarea (uno por línea)
  fecha_creacion        TEXT NOT NULL DEFAULT (datetime('now')),
  prioridad             TEXT NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja','media','alta')),
  fecha_cierre          TEXT,
  cliente_id            INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  interna               INTEGER NOT NULL DEFAULT 0, -- 1 = tarea interna de FLAKS (sin cliente)
  estado                TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_progreso','completada')),
  creado_por            TEXT,
  ultima_modificacion_por TEXT,
  ultima_modificacion_en  TEXT
);

-- Partes / sub-items de una tarea (checklist que se ve en el desarrollo).
CREATE TABLE IF NOT EXISTS tarea_partes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id  INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  texto     TEXT NOT NULL,
  hecho     INTEGER NOT NULL DEFAULT 0,
  orden     INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Asignación de usuarios a tareas / tareas de contenido (varios por ítem).
CREATE TABLE IF NOT EXISTS asignaciones (
  tipo    TEXT NOT NULL,                            -- 'tarea' | 'contenido'
  ref_id  INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (tipo, ref_id, user_id)
);

-- Notificaciones por usuario (cambios en tareas donde participa, etc.).
CREATE TABLE IF NOT EXISTS notificaciones (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL DEFAULT 'tarea',
  ref_id     INTEGER,
  texto      TEXT NOT NULL,
  url        TEXT,
  de_quien   TEXT,
  leida      INTEGER NOT NULL DEFAULT 0,
  creada_en  TEXT NOT NULL DEFAULT (datetime('now'))
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

-- Pago de un trabajo recurrente en un mes puntual. Si no hay fila para el mes,
-- ese trabajo figura "pendiente" ese mes (se "reinicia" solo el 1° de cada mes).
CREATE TABLE IF NOT EXISTS pagos_recurrentes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recurrente_id  INTEGER NOT NULL REFERENCES trabajos_recurrentes(id) ON DELETE CASCADE,
  periodo        TEXT NOT NULL,                  -- 'YYYY-MM'
  fecha_pago     TEXT NOT NULL,                  -- 'YYYY-MM-DD' (fecha en que realmente pagó)
  registrado_por TEXT,
  registrado_en  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (recurrente_id, periodo)
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
CREATE INDEX IF NOT EXISTS idx_tarea_partes ON tarea_partes(tarea_id);
CREATE INDEX IF NOT EXISTS idx_asignaciones ON asignaciones(tipo, ref_id);
CREATE INDEX IF NOT EXISTS idx_asignaciones_user ON asignaciones(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notificaciones(user_id, leida);
CREATE INDEX IF NOT EXISTS idx_recurrentes_cliente ON trabajos_recurrentes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pagos_rec_periodo ON pagos_recurrentes(recurrente_id, periodo);
CREATE INDEX IF NOT EXISTS idx_unicos_cliente ON trabajos_unicos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_audit_entidad ON audit_log(entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_tareas_contenido_cliente ON tareas_contenido(cliente_id);
CREATE INDEX IF NOT EXISTS idx_contenido_links_tarea ON contenido_links(tarea_id);
CREATE INDEX IF NOT EXISTS idx_contenido_links_norm ON contenido_links(url_norm);
