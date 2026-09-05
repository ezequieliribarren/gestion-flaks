'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const audit = require('../lib/audit');

const router = express.Router();

const CATEGORIAS = ['presupuesto', 'tutorial', 'otro'];
const UPLOADS_DIR = path.join(__dirname, '..', 'storage', 'uploads');

const EXT_PERMITIDAS = ['.pdf', '.doc', '.docx', '.txt'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const cat = CATEGORIAS.includes(req.body.categoria) ? req.body.categoria : 'otro';
    const dir = path.join(UPLOADS_DIR, cat);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60);
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (EXT_PERMITIDAS.includes(ext)) return cb(null, true);
    cb(new Error('Tipo de archivo no permitido. Solo PDF, Word (.doc/.docx) o texto (.txt).'));
  },
});

router.get('/', (req, res) => {
  const fCat = CATEGORIAS.includes(req.query.categoria) ? req.query.categoria : null;
  const fCliente = req.query.cliente ? Number(req.query.cliente) : null;
  const where = [];
  const params = [];
  if (fCat) { where.push('d.categoria = ?'); params.push(fCat); }
  if (fCliente) { where.push('d.cliente_id = ?'); params.push(fCliente); }
  const docs = db.prepare(`
    SELECT d.*, c.nombre AS cliente_nombre, c.color AS cliente_color
    FROM documentos d LEFT JOIN clientes c ON c.id = d.cliente_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY d.subido_en DESC
  `).all(...params);
  const clientes = db.prepare('SELECT id, nombre FROM clientes ORDER BY nombre').all();
  res.render('documentos/index', {
    titulo: 'Documentos',
    docs,
    clientes,
    CATEGORIAS,
    filtros: { categoria: fCat, cliente: fCliente },
  });
});

router.post('/', (req, res) => {
  upload.single('archivo')(req, res, (err) => {
    if (err) { req.session.flash = { tipo: 'error', msg: err.message }; return res.redirect('/documentos'); }
    if (!req.file) { req.session.flash = { tipo: 'error', msg: 'Seleccioná un archivo.' }; return res.redirect('/documentos'); }
    const categoria = CATEGORIAS.includes(req.body.categoria) ? req.body.categoria : 'otro';
    const cliente_id = req.body.cliente_id ? Number(req.body.cliente_id) : null;
    const rel = path.relative(path.join(__dirname, '..', 'storage'), req.file.path).replace(/\\/g, '/');
    const info = db.prepare(`
      INSERT INTO documentos (nombre_original, ruta_archivo, categoria, cliente_id, subido_por)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.file.originalname, rel, categoria, cliente_id, req.session.user.nombre);
    audit.registrar(req, 'documentos', info.lastInsertRowid, 'crear', `Subió "${req.file.originalname}"`);
    req.session.flash = { tipo: 'ok', msg: 'Documento subido.' };
    res.redirect('/documentos');
  });
});

router.get('/:id/descargar', (req, res) => {
  const doc = db.prepare('SELECT * FROM documentos WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'El documento no existe.' });
  const abs = path.join(__dirname, '..', 'storage', doc.ruta_archivo);
  if (!abs.startsWith(path.join(__dirname, '..', 'storage')) || !fs.existsSync(abs)) {
    return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'El archivo no está disponible.' });
  }
  res.download(abs, doc.nombre_original);
});

router.post('/:id/eliminar', (req, res) => {
  const doc = db.prepare('SELECT * FROM documentos WHERE id = ?').get(req.params.id);
  if (!doc) return res.redirect('/documentos');
  const abs = path.join(__dirname, '..', 'storage', doc.ruta_archivo);
  try { if (abs.startsWith(path.join(__dirname, '..', 'storage')) && fs.existsSync(abs)) fs.unlinkSync(abs); } catch (e) { /* noop */ }
  db.prepare('DELETE FROM documentos WHERE id = ?').run(doc.id);
  audit.registrar(req, 'documentos', doc.id, 'eliminar', `Eliminó "${doc.nombre_original}"`);
  req.session.flash = { tipo: 'ok', msg: 'Documento eliminado.' };
  res.redirect('/documentos');
});

module.exports = router;
