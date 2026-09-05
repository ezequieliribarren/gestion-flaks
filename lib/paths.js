'use strict';

const path = require('path');
const fs = require('fs');

// Ubicación de los datos persistentes (base SQLite y archivos subidos).
//
// IMPORTANTE en Hostinger: si el deploy por Git reemplaza la carpeta del
// proyecto en cada push, la base y los uploads DEBEN vivir FUERA de esa carpeta,
// o se pierden en cada deploy. Para eso están estas variables de entorno:
//
//   FLAKS_DATA_DIR    -> carpeta para flaks.sqlite   (ej. /home/USUARIO/flaks-datos)
//   FLAKS_STORAGE_DIR -> carpeta para los documentos (ej. /home/USUARIO/flaks-storage)
//
// Si no se definen, se usan ./data y ./storage dentro del proyecto (bien para
// desarrollo local y para hostings que sí preservan esas carpetas).

const ROOT = path.join(__dirname, '..');

const DATA_DIR = process.env.FLAKS_DATA_DIR
  ? path.resolve(process.env.FLAKS_DATA_DIR)
  : path.join(ROOT, 'data');

const STORAGE_DIR = process.env.FLAKS_STORAGE_DIR
  ? path.resolve(process.env.FLAKS_STORAGE_DIR)
  : path.join(ROOT, 'storage');

const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');

for (const dir of [DATA_DIR, STORAGE_DIR, UPLOADS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = { DATA_DIR, STORAGE_DIR, UPLOADS_DIR, DB_PATH: path.join(DATA_DIR, 'flaks.sqlite') };
