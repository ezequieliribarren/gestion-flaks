'use strict';

const express = require('express');
const db = require('../db');
const audit = require('../lib/audit');
const { periodoDesde, nombreMes } = require('../lib/format');
const { gastosDelMes, cuentaCorrienteGlobal, SOCIOS } = require('../lib/billing');

const router = express.Router();

const TIPOS = ['recurrente', 'unico'];

router.get('/', (req, res) => {
  const { anio, mes } = periodoDesde(req.query);
  const g = gastosDelMes(anio, mes);
  const filas = g.filas.map((x) => ({ ...x, ultima: audit.ultimaModificacion('gastos', x.id) }));

  const prefijo = `${anio}-${String(mes).padStart(2, '0')}`;
  const saldos = db.prepare(
    'SELECT * FROM saldos_gastos ORDER BY fecha DESC, id DESC LIMIT 12'
  ).all();

  res.render('gastos/index', {
    titulo: 'Gastos',
    anio,
    mes,
    nuevoId: req.query.nuevo ? Number(req.query.nuevo) : null,
    filas,
    total: g.total,
    totalSaldado: g.totalSaldado,
    totalPendiente: g.totalPendiente,
    cc: g.cuentaCorriente,
    ccGlobal: cuentaCorrienteGlobal(),
    saldos,
    prefijo,
    SOCIOS,
  });
});

router.get('/nuevo', (req, res) => {
  res.render('gastos/form', { titulo: 'Cargar gasto', gasto: {}, TIPOS, SOCIOS, currentUserNombre: req.session.user.nombre });
});

router.get('/:id/editar', (req, res) => {
  const gasto = db.prepare('SELECT * FROM gastos WHERE id = ?').get(req.params.id);
  if (!gasto) return res.redirect('/gastos');
  res.render('gastos/form', { titulo: 'Editar gasto', gasto, TIPOS, SOCIOS, currentUserNombre: req.session.user.nombre });
});

function leer(body, user) {
  const tipo = TIPOS.includes(body.tipo) ? body.tipo : 'unico';
  const pagado_por = SOCIOS.includes(body.pagado_por)
    ? body.pagado_por
    : (user && SOCIOS.includes(user.nombre) ? user.nombre : null);

  // ¿Saldado? es obligatorio para gastos únicos. Los recurrentes se consideran saldados.
  let saldado;
  if (tipo === 'recurrente') saldado = 1;
  else if (body.saldado === '1') saldado = 1;
  else if (body.saldado === '0') saldado = 0;
  else saldado = null; // falta responder

  return {
    descripcion: String(body.descripcion || '').trim(),
    monto: Number(body.monto || 0),
    tipo,
    fecha: body.fecha ? String(body.fecha).slice(0, 10) : null,
    categoria: String(body.categoria || '').trim() || null,
    activo: body.activo === '0' ? 0 : 1,
    pagado_por,
    saldado,
  };
}

router.post('/', (req, res) => {
  const d = leer(req.body, req.session.user);
  if (!d.descripcion || !d.fecha) {
    req.session.flash = { tipo: 'error', msg: 'Descripción y fecha son obligatorias.' };
    return res.redirect('/gastos/nuevo');
  }
  if (d.saldado === null) {
    req.session.flash = { tipo: 'error', msg: 'Respondé si el gasto está saldado o no.' };
    return res.redirect('/gastos/nuevo');
  }
  const info = db.prepare(`
    INSERT INTO gastos (descripcion, monto, tipo, fecha, categoria, activo, pagado_por, saldado, creado_por)
    VALUES (@descripcion, @monto, @tipo, @fecha, @categoria, @activo, @pagado_por, @saldado, @usuario)
  `).run({ ...d, usuario: req.session.user.nombre });
  const estado = d.saldado ? 'saldado' : 'a cuenta corriente';
  audit.registrar(req, 'gastos', info.lastInsertRowid, 'crear', `Cargó gasto "${d.descripcion}" (${d.monto}) pagado por ${d.pagado_por || 's/d'} — ${estado}`);
  req.session.flash = { tipo: 'ok', msg: d.saldado ? 'Gasto cargado. Ya figura en Caja.' : 'Gasto cargado a la cuenta corriente.' };
  res.redirect('/gastos?anio=' + String(d.fecha).slice(0, 4) + '&mes=' + Number(String(d.fecha).slice(5, 7)) + '&nuevo=' + info.lastInsertRowid);
});

router.post('/saldar', (req, res) => {
  const { anio, mes } = periodoDesde(req.body);
  const prefijo = `${anio}-${String(mes).padStart(2, '0')}`;
  const g = gastosDelMes(anio, mes);
  const cc = g.cuentaCorriente;

  const pendientes = db.prepare(
    "SELECT id FROM gastos WHERE saldado = 0 AND tipo = 'unico' AND substr(fecha,1,7) = ?"
  ).all(prefijo);

  if (!pendientes.length) {
    req.session.flash = { tipo: 'error', msg: 'No hay gastos pendientes de saldar en este mes.' };
    return res.redirect('/gastos?anio=' + anio + '&mes=' + mes);
  }

  let detalle;
  if (cc.montoAIgualar > 0.005) {
    db.prepare(`
      INSERT INTO saldos_gastos (periodo, de_quien, a_quien, monto, detalle, registrado_por)
      VALUES (@periodo, @de, @a, @monto, @detalle, @usuario)
    `).run({
      periodo: prefijo,
      de: cc.deQuien,
      a: cc.aQuien,
      monto: cc.montoAIgualar,
      detalle: `Saldo de ${nombreMes(mes)} ${anio} — ${pendientes.length} gasto(s)`,
      usuario: req.session.user.nombre,
    });
    detalle = `${cc.deQuien} le pagó ${cc.montoAIgualar.toFixed(2)} a ${cc.aQuien}`;
  } else {
    detalle = 'ya estaban igualados';
  }

  db.prepare(
    "UPDATE gastos SET saldado = 1 WHERE saldado = 0 AND tipo = 'unico' AND substr(fecha,1,7) = ?"
  ).run(prefijo);

  audit.registrar(req, 'gastos', null, 'saldar',
    `Saldó la cuenta corriente de ${nombreMes(mes)} ${anio}: ${detalle}. ${pendientes.length} gasto(s) pasan a Caja.`);
  req.session.flash = { tipo: 'ok', msg: `Cuenta corriente saldada: ${detalle}. Los gastos ya figuran en Caja.` };
  res.redirect('/gastos?anio=' + anio + '&mes=' + mes);
});

router.post('/:id/saldado', (req, res) => {
  const gasto = db.prepare('SELECT * FROM gastos WHERE id = ?').get(req.params.id);
  if (!gasto) return res.redirect('/gastos');
  const valor = req.body.valor === '1' ? 1 : 0;
  db.prepare('UPDATE gastos SET saldado = ? WHERE id = ?').run(valor, gasto.id);
  audit.registrar(req, 'gastos', gasto.id, 'editar', valor ? 'Marcó el gasto como saldado (pasa a Caja)' : 'Marcó el gasto como no saldado (cuenta corriente)');
  req.session.flash = { tipo: 'ok', msg: valor ? 'Gasto marcado como saldado.' : 'Gasto movido a la cuenta corriente.' };
  res.redirect(req.get('referer') || '/gastos');
});

router.post('/:id', (req, res) => {
  const gasto = db.prepare('SELECT * FROM gastos WHERE id = ?').get(req.params.id);
  if (!gasto) return res.redirect('/gastos');
  const d = leer(req.body, req.session.user);
  if (!d.descripcion || !d.fecha) {
    req.session.flash = { tipo: 'error', msg: 'Descripción y fecha son obligatorias.' };
    return res.redirect('/gastos/' + gasto.id + '/editar');
  }
  if (d.saldado === null) {
    req.session.flash = { tipo: 'error', msg: 'Respondé si el gasto está saldado o no.' };
    return res.redirect('/gastos/' + gasto.id + '/editar');
  }
  db.prepare(`
    UPDATE gastos SET descripcion=@descripcion, monto=@monto, tipo=@tipo, fecha=@fecha,
      categoria=@categoria, activo=@activo, pagado_por=@pagado_por, saldado=@saldado
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
