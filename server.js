'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('./lib/session-store')(session);
const expressLayouts = require('express-ejs-layouts');

const db = require('./db');
const { seedUsers } = require('./db/seed-users');
const { importarDatosIniciales } = require('./db/importar');
const { importarContenidoHistorico } = require('./db/importar-contenido');
const { requireAuth, soloAdmin } = require('./middleware/auth');
const fmt = require('./lib/format');

// Al arrancar, crea/actualiza a German y Ezequiel desde las variables de entorno.
// Así el deploy es sólo "cargar variables + Restart", sin correr scripts a mano.
try {
  console.log('--- Sincronizando usuarios desde variables de entorno ---');
  const ok = seedUsers();
  if (!ok) {
    console.warn('!!! Ningún usuario configurado. Cargá GERMAN_USERNAME/GERMAN_PASSWORD y');
    console.warn('!!! EZEQUIEL_USERNAME/EZEQUIEL_PASSWORD en las variables de entorno y reiniciá.');
  }
  console.log('---------------------------------------------------------');
} catch (e) {
  console.error('Error sincronizando usuarios:', e);
}

// Importa (una sola vez) los datos históricos de la planilla anterior.
try {
  importarDatosIniciales();
} catch (e) {
  console.error('Error importando datos iniciales:', e);
}

// Importa (una sola vez) el histórico de links de historias de SISTEMA CONTINUO.
try {
  importarContenidoHistorico();
} catch (e) {
  console.error('Error importando histórico de contenido:', e);
}

const app = express();
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';
if (PROD) app.set('trust proxy', 1);

// --- Carpetas persistentes (lib/paths.js las crea; ubicación configurable por env) ---
const { DATA_DIR, STORAGE_DIR } = require('./lib/paths');
console.log('Datos en:', DATA_DIR);
console.log('Documentos en:', STORAGE_DIR);

// --- Vistas ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// --- Middlewares base ---
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore(),
    secret: process.env.SESSION_SECRET || 'flaks-dev-secret-cambiar',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 días
      httpOnly: true,
      sameSite: 'lax',
      secure: PROD,
    },
  })
);

// Helpers disponibles en todas las vistas.
const { esAdmin } = require('./middleware/auth');
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.esAdmin = esAdmin(req.session.user);
  res.locals.currentPath = req.path;
  res.locals.fmt = fmt;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

// --- Rutas ---
app.use('/', require('./routes/auth'));
app.use('/contenido', requireAuth, require('./routes/contenido'));
app.use('/tareas', requireAuth, soloAdmin, require('./routes/tareas'));
app.use('/clientes', requireAuth, soloAdmin, require('./routes/clientes'));
app.use('/facturacion', requireAuth, soloAdmin, require('./routes/facturacion'));
app.use('/gastos', requireAuth, soloAdmin, require('./routes/gastos'));
app.use('/caja', requireAuth, soloAdmin, require('./routes/caja'));
app.use('/documentos', requireAuth, soloAdmin, require('./routes/documentos'));

app.get('/', requireAuth, (req, res) =>
  res.redirect(req.session.user.rol === 'contenido' ? '/contenido' : '/tareas'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'La página que buscás no existe.' });
});

// Errores
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    titulo: 'Error',
    mensaje: 'Ocurrió un error inesperado. Revisá los datos e intentá de nuevo.',
  });
});

app.listen(PORT, () => {
  console.log(`Flaks Gestión escuchando en http://localhost:${PORT}`);
});
