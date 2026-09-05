'use strict';

require('dotenv').config();

const bcrypt = require('bcryptjs');
const db = require('./index');

function upsertUser(nombre, usuario, password) {
  if (!usuario || !password) {
    console.warn(`! Falta usuario/contraseña para ${nombre} en .env — se omite.`);
    return;
  }
  const existente = db.prepare('SELECT id FROM users WHERE usuario = ?').get(usuario);
  const hash = bcrypt.hashSync(password, 10);
  if (existente) {
    db.prepare('UPDATE users SET nombre = ?, password_hash = ? WHERE id = ?').run(nombre, hash, existente.id);
    console.log(`= Usuario actualizado: ${usuario}`);
  } else {
    db.prepare('INSERT INTO users (nombre, usuario, password_hash) VALUES (?, ?, ?)').run(nombre, usuario, hash);
    console.log(`+ Usuario creado: ${usuario}`);
  }
}

function seedUsers() {
  upsertUser('German', process.env.GERMAN_USERNAME, process.env.GERMAN_PASSWORD);
  upsertUser('Ezequiel', process.env.EZEQUIEL_USERNAME, process.env.EZEQUIEL_PASSWORD);
}

function seedDemo() {
  if (String(process.env.SEED_DEMO_DATA).toLowerCase() !== 'true') {
    console.log('· SEED_DEMO_DATA no es true — no se cargan datos de ejemplo.');
    return;
  }
  const yaHay = db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n;
  if (yaHay > 0) {
    console.log('· Ya existen clientes — no se cargan datos de ejemplo.');
    return;
  }

  const hoy = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const esteMes = (dia) => iso(new Date(hoy.getFullYear(), hoy.getMonth(), dia));

  const insCliente = db.prepare(
    "INSERT INTO clientes (nombre, color, estado, notas, creado_por) VALUES (?, ?, ?, ?, 'seed')"
  );
  const insRec = db.prepare(
    'INSERT INTO trabajos_recurrentes (cliente_id, nombre, monto_mensual, reparto_german, reparto_ezequiel, activo, dia_de_cobro) VALUES (?, ?, ?, ?, ?, 1, ?)'
  );
  const insUni = db.prepare(
    'INSERT INTO trabajos_unicos (cliente_id, nombre, monto, fecha, reparto_german, reparto_ezequiel) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insTarea = db.prepare(
    "INSERT INTO tareas (nombre, descripcion, prioridad, fecha_cierre, cliente_id, estado, creado_por) VALUES (?, ?, ?, ?, ?, ?, 'seed')"
  );

  const panaderia = insCliente.run('Panadería del Sol', '#f59e0b', 'activo', 'Cliente de e-commerce en Tienda Nube. Contacto: Marta.').lastInsertRowid;
  const estudio = insCliente.run('Estudio Contable López', '#2563eb', 'activo', 'Sitio institucional en WordPress + campañas de Google Ads.').lastInsertRowid;
  const gimnasio = insCliente.run('Gimnasio Titan', '#16a34a', 'potencial', 'Presupuesto enviado por sitio web + Meta Ads. Esperando respuesta.').lastInsertRowid;

  insRec.run(panaderia, 'Mantenimiento Tienda Nube', 45000, 60, 40, 5);
  insRec.run(panaderia, 'Gestión Meta Ads', 60000, 50, 50, 10);
  insRec.run(estudio, 'Hosting + mantenimiento WordPress', 30000, 40, 60, 1);
  insRec.run(estudio, 'Gestión Google Ads', 80000, 50, 50, 1);
  insRec.run(gimnasio, 'Gestión Meta Ads (proyectado)', 55000, 50, 50, 10);

  insUni.run(panaderia, 'Rediseño de home + banners temporada', 120000, esteMes(12), 50, 50);
  insUni.run(estudio, 'Landing page campaña impuestos', 90000, esteMes(20), 30, 70);

  insTarea.run('Actualizar catálogo de productos', 'Cargar 15 productos nuevos de la temporada.', 'alta', esteMes(hoy.getDate()), panaderia, 'en_progreso');
  insTarea.run('Optimizar campaña de conversiones', 'Revisar públicos y creativos con bajo rendimiento.', 'media', esteMes(25), panaderia, 'pendiente');
  insTarea.run('Publicar artículo del blog', 'Nota sobre cierre de balance.', 'baja', esteMes(28), estudio, 'pendiente');
  insTarea.run('Enviar reporte mensual de Ads', 'Reporte de septiembre con métricas clave.', 'media', esteMes(hoy.getDate()), estudio, 'pendiente');
  insTarea.run('Preparar propuesta comercial', 'Armar presupuesto detallado para el gimnasio.', 'alta', esteMes(10), gimnasio, 'completada');
  insTarea.run('Renovar certificados SSL', 'Revisar vencimientos de todos los hostings.', 'media', null, null, 'pendiente');

  db.prepare("INSERT INTO gastos (descripcion, monto, tipo, fecha, categoria, creado_por) VALUES (?, ?, 'recurrente', ?, 'Herramientas', 'seed')")
    .run('Suscripción a herramientas de diseño y SEO', 25000, esteMes(1));
  db.prepare("INSERT INTO gastos (descripcion, monto, tipo, fecha, categoria, creado_por) VALUES (?, ?, 'unico', ?, 'Publicidad', 'seed')")
    .run('Curso de Google Ads', 40000, esteMes(8));

  console.log('+ Datos de ejemplo cargados (3 clientes, tareas, trabajos y gastos).');
}

seedUsers();
seedDemo();
console.log('Seed finalizado.');
