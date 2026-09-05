'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// La base vive dentro del proyecto, en /data, para que sea persistente en Hostinger.
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'flaks.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Ejecuta el esquema (idempotente).
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

module.exports = db;
module.exports.DATA_DIR = DATA_DIR;
module.exports.DB_PATH = DB_PATH;
