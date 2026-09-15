'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const audit = require('../lib/audit');
const { STORAGE_DIR, UPLOADS_DIR } = require('../lib/paths');

const router = express.Router();

const ESTADOS = ['activo', 'potencial', 'inactivo'];

// --- Subida de logos de clientes ---
const LOGOS_DIR = path.join(UPLOADS_DIR, 'logos');
const EXT_LOGO = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(LOGOS_DIR, { recursive: true });
      cb(null, LOGOS_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `logo-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (EXT_LOGO.includes(path.extname(file.originalname).toLowerCase())) return cb(null, true);
    cb(new Error('El logo tiene que ser una imagen (PNG, JPG, WEBP, GIF o SVG).'));
  },
}).single('logo');

// Guarda el archivo subido como logo del cliente y borra el anterior.
function guardarLogo(req, cliente) {
  if (!req.file) return null;
  const rel = path.relative(STORAGE_DIR, req.file.path).replace(/\\/g, '/');
  if (cliente && cliente.logo) borrarLogoArchivo(cliente.logo);
  db.prepare('UPDATE clientes SET logo = ? WHERE id = ?').run(rel, (cliente && cliente.id) || req._nuevoClienteId);
  return rel;
}

function borrarLogoArchivo(rel) {
  try {
    const abs = path.join(STORAGE_DIR, rel);
    if (abs.startsWith(STORAGE_DIR) && fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (e) { /* noop */ }
}

function repartoValido(g, e) {
  const rg = Number(g);
  const re = Number(e);
  if (isNaN(rg) || isNaN(re) || rg < 0 || re < 0) return null;
  return { rg, re };
}

// estado_efectivo: un cliente inactivo con un trabajo único "potencial" figura como potencial.
const ESTADO_EFECTIVO = `
  CASE WHEN c.estado = 'inactivo'
        AND EXISTS (SELECT 1 FROM trabajos_unicos WHERE cliente_id = c.id AND estado = 'potencial')
       THEN 'potencial' ELSE c.estado END`;

const ESTADO_PARAMS = ['activo', 'potencial', 'inactivo', 'todos'];

router.get('/', (req, res) => {
  // Se recuerda la última vista/filtro/orden/búsqueda en la sesión: si un
  // parámetro no viene en la URL, se usa el último elegido.
  const sess = req.session.clientesFiltro || {};

  const vista = ['lista', 'carpetas'].includes(req.query.vista)
    ? req.query.vista
    : (['lista', 'carpetas'].includes(sess.vista) ? sess.vista : 'carpetas');

  const estadoParam = ESTADO_PARAMS.includes(req.query.estado)
    ? req.query.estado
    : (ESTADO_PARAMS.includes(sess.estado) ? sess.estado : 'activo');
  const filtroEstado = estadoParam === 'todos' ? null : estadoParam;

  const orden = ['facturacion', 'nombre'].includes(req.query.orden)
    ? req.query.orden
    : (sess.orden === 'facturacion' ? 'facturacion' : 'nombre');

  const q = ('q' in req.query) ? String(req.query.q || '').trim() : String(sess.q || '');

  req.session.clientesFiltro = { vista, estado: estadoParam, orden, q };

  const ordenSql = orden === 'facturacion'
    ? 'total_facturado DESC, nombre COLLATE NOCASE'
    : `CASE estado_efectivo WHEN 'activo' THEN 0 WHEN 'potencial' THEN 1 ELSE 2 END, nombre COLLATE NOCASE`;

  const where = [];
  const params = [];
  if (filtroEstado) { where.push('estado_efectivo = ?'); params.push(filtroEstado); }
  if (q) { where.push('LOWER(nombre) LIKE LOWER(?)'); params.push('%' + q + '%'); }

  const clientes = db.prepare(`
    SELECT * FROM (
      SELECT c.*,
        (SELECT COALESCE(SUM(monto_mensual),0) FROM trabajos_recurrentes WHERE cliente_id = c.id AND activo = 1) AS mensual,
        (SELECT COALESCE(SUM(monto_mensual),0) FROM trabajos_recurrentes WHERE cliente_id = c.id AND activo = 1)
          + (SELECT COALESCE(SUM(monto),0) FROM trabajos_unicos WHERE cliente_id = c.id AND estado = 'pendiente')
          + (SELECT COALESCE(SUM(monto),0) FROM cobros WHERE cliente_id = c.id) AS total_facturado,
        (SELECT COUNT(*) FROM tareas WHERE cliente_id = c.id AND estado != 'completada') AS tareas_abiertas,
        (SELECT COUNT(*) FROM trabajos_unicos WHERE cliente_id = c.id AND estado = 'potencial') AS trabajos_potenciales,
        ${ESTADO_EFECTIVO} AS estado_efectivo
      FROM clientes c
    )
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${ordenSql}
  `).all(...params);

  const conteo = db.prepare(`
    SELECT
      SUM(ee = 'activo')    AS activo,
      SUM(ee = 'potencial') AS potencial,
      SUM(ee = 'inactivo')  AS inactivo,
      COUNT(*)              AS total
    FROM (SELECT ${ESTADO_EFECTIVO} AS ee FROM clientes c)
  `).get();

  res.render('clientes/index', { titulo: 'Clientes', clientes, vista, filtroEstado, orden, q, conteo });
});

router.get('/nuevo', (req, res) => {
  res.render('clientes/form', { titulo: 'Nuevo cliente', cliente: {}, ESTADOS });
});

router.post('/', (req, res) => {
  logoUpload(req, res, (err) => {
    if (err) { req.session.flash = { tipo: 'error', msg: err.message }; return res.redirect('/clientes/nuevo'); }
    const nombre = String(req.body.nombre || '').trim();
    const estado = ESTADOS.includes(req.body.estado) ? req.body.estado : 'potencial';
    if (!nombre) {
      if (req.file) borrarLogoArchivo(path.relative(STORAGE_DIR, req.file.path).replace(/\\/g, '/'));
      req.session.flash = { tipo: 'error', msg: 'El nombre es obligatorio.' };
      return res.redirect('/clientes/nuevo');
    }
    const info = db.prepare(
      'INSERT INTO clientes (nombre, estado, creado_por) VALUES (?, ?, ?)'
    ).run(nombre, estado, req.session.user.nombre);
    req._nuevoClienteId = info.lastInsertRowid;
    guardarLogo(req, null);
    audit.registrar(req, 'clientes', info.lastInsertRowid, 'crear', `Creó el cliente "${nombre}"`);
    req.session.flash = { tipo: 'ok', msg: 'Cliente creado.' };
    res.redirect('/clientes/' + info.lastInsertRowid);
  });
});

router.get('/:id', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'El cliente no existe.' });

  const d = new Date();
  const mesPrefijo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  const recurrentes = db.prepare(`
    SELECT tr.*, pr.fecha_pago AS pago_fecha
    FROM trabajos_recurrentes tr
    LEFT JOIN pagos_recurrentes pr ON pr.recurrente_id = tr.id AND pr.periodo = ?
    WHERE tr.cliente_id = ?
    ORDER BY tr.activo DESC, tr.nombre
  `).all(mesPrefijo, cliente.id);
  const unicos = db.prepare('SELECT * FROM trabajos_unicos WHERE cliente_id = ? ORDER BY fecha DESC').all(cliente.id);
  const cobros = db.prepare('SELECT * FROM cobros WHERE cliente_id = ? ORDER BY fecha DESC').all(cliente.id);
  const mensualTotal = recurrentes.filter((r) => r.activo).reduce((a, r) => a + r.monto_mensual, 0);

  const tareasMes = db.prepare(`
    SELECT * FROM tareas
    WHERE cliente_id = ? AND fecha_cierre IS NOT NULL AND substr(fecha_cierre,1,7) = ?
    ORDER BY estado, fecha_cierre
  `).all(cliente.id, mesPrefijo);

  const clientesLista = db.prepare('SELECT id, nombre FROM clientes ORDER BY nombre COLLATE NOCASE').all();

  const subclientes = db.prepare('SELECT id, nombre FROM clientes WHERE grupo_id = ? ORDER BY nombre COLLATE NOCASE').all(cliente.id);
  const grupoDe = cliente.grupo_id ? db.prepare('SELECT id, nombre FROM clientes WHERE id = ?').get(cliente.grupo_id) : null;
  // Sólo se puede elegir como grupo/padre a un cliente que hoy no sea, a su vez, hijo de otro (1 solo nivel).
  const gruposDisponibles = db.prepare(`
    SELECT id, nombre FROM clientes WHERE id <> ? AND grupo_id IS NULL ORDER BY nombre COLLATE NOCASE
  `).all(cliente.id);

  res.render('clientes/detalle', {
    titulo: cliente.nombre,
    cliente,
    recurrentes,
    unicos,
    cobros,
    hoyISO: hoyISO(),
    mensualTotal,
    tareasMes,
    periodoActual: mesPrefijo,
    clientesLista,
    subclientes,
    grupoDe,
    gruposDisponibles,
    ESTADOS,
    ultima: audit.ultimaModificacion('clientes', cliente.id),
    historial: audit.historial('clientes', cliente.id),
  });
});

// Pasar un ingreso (trabajo único o recurrente) a otro cliente.
function pasarIngreso(tabla, etiqueta) {
  return (req, res) => {
    const t = db.prepare(`SELECT * FROM ${tabla} WHERE id = ? AND cliente_id = ?`).get(req.params.tid, req.params.id);
    const destino = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.body.cliente_destino);
    if (!t || !destino || destino.id === Number(req.params.id)) {
      req.session.flash = { tipo: 'error', msg: 'Elegí un cliente distinto para pasar el ingreso.' };
      return res.redirect('/clientes/' + req.params.id);
    }
    const origen = db.prepare('SELECT nombre FROM clientes WHERE id = ?').get(req.params.id);
    db.prepare(`UPDATE ${tabla} SET cliente_id = ? WHERE id = ?`).run(destino.id, t.id);
    audit.registrar(req, 'clientes', req.params.id, 'editar', `Pasó ${etiqueta} "${t.nombre}" a ${destino.nombre}`);
    audit.registrar(req, 'clientes', destino.id, 'editar', `Recibió ${etiqueta} "${t.nombre}" desde ${origen ? origen.nombre : 'otro cliente'}`);
    req.session.flash = { tipo: 'ok', msg: `"${t.nombre}" pasó a ${destino.nombre}.` };
    res.redirect('/clientes/' + destino.id + '#' + (tabla === 'trabajos_unicos' ? 'unicos' : 'recurrentes'));
  };
}

router.post('/:id/unicos/:tid/pasar', pasarIngreso('trabajos_unicos', 'el trabajo único'));
router.post('/:id/recurrentes/:tid/pasar', pasarIngreso('trabajos_recurrentes', 'el trabajo recurrente'));

router.post('/:id', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  logoUpload(req, res, (err) => {
    if (err) { req.session.flash = { tipo: 'error', msg: err.message }; return res.redirect('/clientes/' + cliente.id); }
    const nombre = String(req.body.nombre || '').trim() || cliente.nombre;
    const estado = ESTADOS.includes(req.body.estado) ? req.body.estado : cliente.estado;
    const campo = (k) => (k in req.body ? String(req.body[k] || '').trim() : cliente[k]);

    let grupoId = cliente.grupo_id;
    if ('grupo_id' in req.body) {
      const gid = parseInt(req.body.grupo_id, 10);
      if (!gid) {
        grupoId = null;
      } else if (gid === cliente.id) {
        req.session.flash = { tipo: 'error', msg: 'Un cliente no puede ser grupo de sí mismo.' };
        return res.redirect('/clientes/' + cliente.id);
      } else {
        const padre = db.prepare('SELECT id, grupo_id FROM clientes WHERE id = ?').get(gid);
        const tieneHijos = db.prepare('SELECT 1 FROM clientes WHERE grupo_id = ? LIMIT 1').get(cliente.id);
        if (!padre || padre.grupo_id) {
          req.session.flash = { tipo: 'error', msg: 'Ese cliente no puede ser grupo (ya pertenece a otro grupo).' };
          return res.redirect('/clientes/' + cliente.id);
        }
        if (tieneHijos) {
          req.session.flash = { tipo: 'error', msg: 'Este cliente ya tiene sub-clientes propios, no puede pasar a depender de otro.' };
          return res.redirect('/clientes/' + cliente.id);
        }
        grupoId = gid;
      }
    }

    db.prepare(`
      UPDATE clientes SET nombre = ?, estado = ?, contacto_nombre = ?, contacto_telefono = ?, contacto_email = ?, grupo_id = ?
      WHERE id = ?
    `).run(nombre, estado, campo('contacto_nombre'), campo('contacto_telefono'), campo('contacto_email'), grupoId, cliente.id);
    guardarLogo(req, cliente);
    audit.registrar(req, 'clientes', cliente.id, 'editar', `Editó el cliente "${nombre}"`);
    req.session.flash = { tipo: 'ok', msg: 'Cliente actualizado.' };
    res.redirect('/clientes/' + cliente.id);
  });
});

// Servir el logo del cliente (la app entera está detrás de login).
router.get('/:id/logo', (req, res) => {
  const cliente = db.prepare('SELECT logo FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente || !cliente.logo) return res.status(404).end();
  const abs = path.join(STORAGE_DIR, cliente.logo);
  if (!abs.startsWith(STORAGE_DIR) || !fs.existsSync(abs)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=60');
  res.sendFile(abs);
});

router.post('/:id/logo/eliminar', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  if (cliente.logo) borrarLogoArchivo(cliente.logo);
  db.prepare('UPDATE clientes SET logo = NULL WHERE id = ?').run(cliente.id);
  audit.registrar(req, 'clientes', cliente.id, 'editar', 'Quitó el logo');
  req.session.flash = { tipo: 'ok', msg: 'Logo quitado.' };
  res.redirect('/clientes/' + cliente.id);
});

// Cambio rápido de estado desde la lista de clientes.
router.post('/:id/estado', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  const estado = ESTADOS.includes(req.body.estado) ? req.body.estado : cliente.estado;
  if (estado !== cliente.estado) {
    db.prepare('UPDATE clientes SET estado = ? WHERE id = ?').run(estado, cliente.id);
    audit.registrar(req, 'clientes', cliente.id, 'editar', `Cambió el estado de "${cliente.nombre}" a ${estado}`);
    req.session.flash = { tipo: 'ok', msg: `"${cliente.nombre}" ahora es ${estado}.` };
  }
  res.redirect(req.get('referer') || '/clientes');
});

router.post('/:id/notas', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  db.prepare('UPDATE clientes SET notas = ? WHERE id = ?').run(String(req.body.notas || ''), cliente.id);
  audit.registrar(req, 'clientes', cliente.id, 'editar', 'Actualizó las anotaciones');
  req.session.flash = { tipo: 'ok', msg: 'Anotaciones guardadas.' };
  res.redirect('/clientes/' + cliente.id);
});

router.post('/:id/eliminar', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  if (cliente.logo) borrarLogoArchivo(cliente.logo);
  db.prepare('DELETE FROM clientes WHERE id = ?').run(cliente.id);
  audit.registrar(req, 'clientes', cliente.id, 'eliminar', `Eliminó el cliente "${cliente.nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Cliente eliminado.' };
  res.redirect('/clientes');
});

// --- Trabajos recurrentes ---
router.post('/:id/recurrentes', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  const nombre = String(req.body.nombre || '').trim();
  const monto = Number(req.body.monto_mensual || 0);
  const rep = repartoValido(req.body.reparto_german, req.body.reparto_ezequiel);
  const dia = req.body.dia_de_cobro ? Math.min(28, Math.max(1, Number(req.body.dia_de_cobro))) : null;
  if (!nombre || !rep) { req.session.flash = { tipo: 'error', msg: 'Datos del trabajo recurrente inválidos.' }; return res.redirect('/clientes/' + cliente.id); }
  const info = db.prepare(`
    INSERT INTO trabajos_recurrentes (cliente_id, nombre, monto_mensual, reparto_german, reparto_ezequiel, activo, dia_de_cobro)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(cliente.id, nombre, monto, rep.rg, rep.re, dia);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Agregó trabajo recurrente "${nombre}" (${monto})`);
  req.session.flash = { tipo: 'ok', msg: 'Trabajo recurrente agregado.' };
  res.redirect('/clientes/' + cliente.id + '#recurrentes');
});

router.post('/:id/recurrentes/:tid', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  const t = db.prepare('SELECT * FROM trabajos_recurrentes WHERE id = ? AND cliente_id = ?').get(req.params.tid, req.params.id);
  if (!cliente || !t) return res.redirect('/clientes');
  if (req.body._accion === 'eliminar') {
    db.prepare('DELETE FROM trabajos_recurrentes WHERE id = ?').run(t.id);
    audit.registrar(req, 'clientes', cliente.id, 'editar', `Eliminó trabajo recurrente "${t.nombre}"`);
    req.session.flash = { tipo: 'ok', msg: 'Trabajo recurrente eliminado.' };
    return res.redirect('/clientes/' + cliente.id + '#recurrentes');
  }
  const nombre = String(req.body.nombre || '').trim() || t.nombre;
  const monto = req.body.monto_mensual != null ? Number(req.body.monto_mensual) : t.monto_mensual;
  const rep = repartoValido(req.body.reparto_german, req.body.reparto_ezequiel) || { rg: t.reparto_german, re: t.reparto_ezequiel };
  const activo = req.body.activo === '1' || req.body.activo === 'on' ? 1 : 0;
  const dia = req.body.dia_de_cobro ? Math.min(28, Math.max(1, Number(req.body.dia_de_cobro))) : null;
  db.prepare(`
    UPDATE trabajos_recurrentes SET nombre=?, monto_mensual=?, reparto_german=?, reparto_ezequiel=?, activo=?, dia_de_cobro=?
    WHERE id=?
  `).run(nombre, monto, rep.rg, rep.re, activo, dia, t.id);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Editó trabajo recurrente "${nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Trabajo recurrente actualizado.' };
  res.redirect('/clientes/' + cliente.id + '#recurrentes');
});

// Registrar / borrar el pago de un trabajo recurrente para un mes (periodo 'YYYY-MM').
router.post('/:id/recurrentes/:tid/pago', (req, res) => {
  const t = db.prepare('SELECT * FROM trabajos_recurrentes WHERE id = ? AND cliente_id = ?').get(req.params.tid, req.params.id);
  if (!t) return res.redirect('/clientes');
  const periodo = /^\d{4}-\d{2}$/.test(req.body.periodo) ? req.body.periodo : new Date().toISOString().slice(0, 7);
  const fecha = req.body.fecha ? String(req.body.fecha).slice(0, 10) : null;

  if (fecha) {
    db.prepare(`
      INSERT INTO pagos_recurrentes (recurrente_id, periodo, fecha_pago, registrado_por)
      VALUES (@rid, @periodo, @fecha, @usuario)
      ON CONFLICT(recurrente_id, periodo) DO UPDATE SET fecha_pago = @fecha, registrado_por = @usuario, registrado_en = datetime('now')
    `).run({ rid: t.id, periodo, fecha, usuario: req.session.user.nombre });
    audit.registrar(req, 'clientes', req.params.id, 'editar', `Registró pago de "${t.nombre}" (${periodo}) el ${fecha}`);
    req.session.flash = { tipo: 'ok', msg: 'Pago registrado.' };
  } else {
    db.prepare('DELETE FROM pagos_recurrentes WHERE recurrente_id = ? AND periodo = ?').run(t.id, periodo);
    audit.registrar(req, 'clientes', req.params.id, 'editar', `Marcó como pendiente el pago de "${t.nombre}" (${periodo})`);
    req.session.flash = { tipo: 'ok', msg: 'Marcado como pendiente.' };
  }
  res.redirect('/clientes/' + req.params.id + '#recurrentes');
});

// --- Trabajos (de una sola vez, sin cobrar todavía) ---
const ESTADOS_TRABAJO = ['pendiente', 'potencial'];

function hoyISO() { return new Date().toISOString().slice(0, 10); }

function activarSiHaciaFalta(req, cliente) {
  if (cliente.estado === 'activo') return '';
  db.prepare("UPDATE clientes SET estado = 'activo' WHERE id = ?").run(cliente.id);
  return ' El cliente pasó a Activo.';
}

router.post('/:id/unicos', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  const nombre = String(req.body.nombre || '').trim();
  const monto = Number(req.body.monto || 0);
  const fecha = req.body.fecha ? String(req.body.fecha).slice(0, 10) : null;
  const rep = repartoValido(req.body.reparto_german, req.body.reparto_ezequiel);
  const estado = ESTADOS_TRABAJO.includes(req.body.estado) ? req.body.estado : 'pendiente';
  if (!nombre || !fecha || !rep) { req.session.flash = { tipo: 'error', msg: 'Datos del trabajo inválidos.' }; return res.redirect('/clientes/' + cliente.id); }
  db.prepare(`
    INSERT INTO trabajos_unicos (cliente_id, nombre, monto, fecha, reparto_german, reparto_ezequiel, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cliente.id, nombre, monto, fecha, rep.rg, rep.re, estado);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Agregó el trabajo "${nombre}" (${monto}) — ${estado}`);
  req.session.flash = { tipo: 'ok', msg: estado === 'potencial' ? 'Trabajo potencial agregado.' : 'Trabajo agregado.' };
  res.redirect('/clientes/' + cliente.id + '#unicos');
});

router.post('/:id/unicos/:tid', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  const t = db.prepare('SELECT * FROM trabajos_unicos WHERE id = ? AND cliente_id = ?').get(req.params.tid, req.params.id);
  if (!cliente || !t) return res.redirect('/clientes');

  if (req.body._accion === 'eliminar') {
    db.prepare('DELETE FROM trabajos_unicos WHERE id = ?').run(t.id);
    audit.registrar(req, 'clientes', cliente.id, 'editar', `Eliminó el trabajo "${t.nombre}"`);
    req.session.flash = { tipo: 'ok', msg: 'Trabajo eliminado.' };
    return res.redirect('/clientes/' + cliente.id + '#unicos');
  }

  const nombre = String(req.body.nombre || '').trim() || t.nombre;
  const monto = req.body.monto != null ? Number(req.body.monto) : t.monto;
  const fecha = req.body.fecha ? String(req.body.fecha).slice(0, 10) : t.fecha;
  const rep = repartoValido(req.body.reparto_german, req.body.reparto_ezequiel) || { rg: t.reparto_german, re: t.reparto_ezequiel };
  const estado = ESTADOS_TRABAJO.includes(req.body.estado) ? req.body.estado : t.estado;
  db.prepare('UPDATE trabajos_unicos SET nombre=?, monto=?, fecha=?, reparto_german=?, reparto_ezequiel=?, estado=? WHERE id=?')
    .run(nombre, monto, fecha, rep.rg, rep.re, estado, t.id);

  // Si el trabajo pasa a confirmado (pendiente) y el cliente estaba inactivo/potencial, se reactiva.
  const extra = (estado === 'pendiente' && t.estado === 'potencial') ? activarSiHaciaFalta(req, cliente) : '';

  audit.registrar(req, 'clientes', cliente.id, 'editar',
    estado !== t.estado ? `Marcó "${nombre}" como ${estado === 'pendiente' ? 'Pendiente de cobro' : 'Potencial'}.${extra}` : `Editó el trabajo "${nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Trabajo actualizado.' + extra };
  res.redirect('/clientes/' + cliente.id + '#unicos');
});

// Convierte un trabajo pendiente en un cobro (con la fecha real en que se cobró) y lo saca de Trabajos.
router.post('/:id/unicos/:tid/cobrar', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  const t = db.prepare('SELECT * FROM trabajos_unicos WHERE id = ? AND cliente_id = ?').get(req.params.tid, req.params.id);
  if (!cliente || !t) return res.redirect('/clientes');
  const fecha = req.body.fecha ? String(req.body.fecha).slice(0, 10) : hoyISO();

  db.prepare(`
    INSERT INTO cobros (cliente_id, concepto, monto, reparto_german, reparto_ezequiel, fecha_trabajo, fecha, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cliente.id, t.nombre, t.monto, t.reparto_german, t.reparto_ezequiel, t.fecha, fecha, req.session.user.nombre);
  db.prepare('DELETE FROM trabajos_unicos WHERE id = ?').run(t.id);

  const extra = activarSiHaciaFalta(req, cliente);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Cobró "${t.nombre}" (${t.monto}) el ${fecha}.${extra}`);
  req.session.flash = { tipo: 'ok', msg: 'Cobro registrado.' + extra };
  res.redirect('/clientes/' + cliente.id + '#cobros');
});

// --- Cobros realizados ---
router.post('/:id/cobros', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.redirect('/clientes');
  const nombre = String(req.body.nombre || '').trim();
  const monto = Number(req.body.monto || 0);
  const fecha = req.body.fecha ? String(req.body.fecha).slice(0, 10) : null;
  const fechaTrabajo = req.body.fecha_trabajo ? String(req.body.fecha_trabajo).slice(0, 10) : fecha;
  const rep = repartoValido(req.body.reparto_german, req.body.reparto_ezequiel);
  if (!nombre || !fecha || !rep) { req.session.flash = { tipo: 'error', msg: 'Datos del cobro inválidos.' }; return res.redirect('/clientes/' + cliente.id); }
  db.prepare(`
    INSERT INTO cobros (cliente_id, concepto, monto, reparto_german, reparto_ezequiel, fecha_trabajo, fecha, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cliente.id, nombre, monto, rep.rg, rep.re, fechaTrabajo, fecha, req.session.user.nombre);
  const extra = activarSiHaciaFalta(req, cliente);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Registró el cobro "${nombre}" (${monto}).${extra}`);
  req.session.flash = { tipo: 'ok', msg: 'Cobro agregado.' + extra };
  res.redirect('/clientes/' + cliente.id + '#cobros');
});

router.post('/:id/cobros/:cid', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  const co = db.prepare('SELECT * FROM cobros WHERE id = ? AND cliente_id = ?').get(req.params.cid, req.params.id);
  if (!cliente || !co) return res.redirect('/clientes');

  if (req.body._accion === 'eliminar') {
    db.prepare('DELETE FROM cobros WHERE id = ?').run(co.id);
    audit.registrar(req, 'clientes', cliente.id, 'editar', `Eliminó el cobro "${co.concepto}"`);
    req.session.flash = { tipo: 'ok', msg: 'Cobro eliminado.' };
    return res.redirect('/clientes/' + cliente.id + '#cobros');
  }

  const nombre = String(req.body.nombre || '').trim() || co.concepto;
  const monto = req.body.monto != null ? Number(req.body.monto) : co.monto;
  const fecha = req.body.fecha ? String(req.body.fecha).slice(0, 10) : co.fecha;
  const fechaTrabajo = req.body.fecha_trabajo ? String(req.body.fecha_trabajo).slice(0, 10) : co.fecha_trabajo;
  const rep = repartoValido(req.body.reparto_german, req.body.reparto_ezequiel) || { rg: co.reparto_german, re: co.reparto_ezequiel };
  db.prepare('UPDATE cobros SET concepto=?, monto=?, fecha=?, fecha_trabajo=?, reparto_german=?, reparto_ezequiel=? WHERE id=?')
    .run(nombre, monto, fecha, fechaTrabajo, rep.rg, rep.re, co.id);
  audit.registrar(req, 'clientes', cliente.id, 'editar', `Editó el cobro "${nombre}"`);
  req.session.flash = { tipo: 'ok', msg: 'Cobro actualizado.' };
  res.redirect('/clientes/' + cliente.id + '#cobros');
});

module.exports = router;
