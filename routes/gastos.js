'use strict';

const express = require('express');
const db = require('../db');
const audit = require('../lib/audit');
const { periodoDesde } = require('../lib/format');
const { gastosDelMes } = require('../lib/billing');

const router = express.Router();

const TIPOS = ['recurrente', 'unico'];

router.get('/', (req, res) => {
  const { anio, mes } = periodoDesde(req.query);
  const { filas, total } = gastosDelMes(anio, mes);
  const filasConAudit = filas.map((g) => ({ ...g, ultima: audit.ultimaModificacion('gastos', g.id) }));
  res.render('gastos/index', { titulo: 'Gastos', anio, mes, filas: filasConAudit, total });
});

router.get('/nuevo', (req, res) => {
  res.render('gastos/form', { titulo: 'Cargar gasto', gasto: {}, TIPOS });
});

router.get('/:id/editar', (req, res) => {
  const gasto = db.prepare('SELECT * FROM gastos WHERE id = ?').get(req.params.id);
  if (!gasto) return res.redirect('/gastos');
  res.render('gastos/form', { titulo: 'Editar gasto', gasto, TIPOS });
});

function leer(body) {
  return {
    descripcion: String(body.descripcion || '').trim(),
    monto: Number(body.monto || 0),
    tipo: TIPOS.includes(body.tipo) ? body.tipo : 'unico',
    fecha: body.fecha ? String(body.fecha).slice(0, 10) : null,
    categoria: String(body.categoria || '').trim() || null,
    activo: body.activo === '0' ? 0 : 1,
  };
}

router.post('/', (req, res) => {
  const d = leer(req.body);
  if (!d.descripcion || !d.fecha) { req.session.flash = { tipo: 'error', msg: 'Descripción y fecha son obligatorias.' }; return res.redirect('/gastos/nuevo'); }
  const info = db.prepare(`
    INSERT INTO gastos (descripcion, monto, tipo, fecha, categoria, activo, creado_por)
    VALUES (@descripcion, @monto, @tipo, @fecha, @categoria, @activo, @usuario)
  `).run({ ...d, usuario: req.session.user.nombre });
  audit.registrar(req, 'gastos', info.lastInsertRowid, 'crear', `Cargó gasto "${d.descripcion}" (${d.monto})`);
  req.session.flash = { tipo: 'ok', msg: 'Gasto cargado.' };
  res.redirect('/gastos');
});

router.post('/:id', (req, res) => {
  const gasto = db.prepare('SELECT * FROM gastos WHERE id = ?').get(req.params.id);
  if (!gasto) return res.redirect('/gastos');
  const d = leer(req.body);
  if (!d.descripcion || !d.fecha) { req.session.flash = { tipo: 'error', msg: 'Descripción y fecha son obligatorias.' }; return res.redirect('/gastos/' + gasto.id + '/editar'); }
  db.prepare(`
    UPDATE gastos SET descripcion=@descripcion, monto=@monto, tipo=@tipo, fecha=@fecha, categoria=@categoria, activo=@activo
    WHERE id=@id
  `).run({ ...d, id: gasto.id });
  audit.registrar(req, 'gastos', gasto.id, 'editar', `Editó gasto "${d.descripcion}"`);
  req.session.flash = { tipo: 'ok', msg: 'Gasto actualizado.' };
  res.redirect('/gastos');
});

router.post('/:id/eliminar', (req, res) => {
  const gasto = db.prepare('SELECT * FROM gastos WHERE id = ?').get(req.params.id);
  if (!gasto) return res.redirect('/gastos');
  db.prepare('DELETE FROM gastos WHERE id = ?').run(gasto.id);
  audit.registrar(req, 'gastos', gasto.id, 'eliminar', `Eliminó gasto "${gasto.descripcion}"`);
  req.session.flash = { tipo: 'ok', msg: 'Gasto eliminado.' };
  res.redirect('/gastos');
});

module.exports = router;
