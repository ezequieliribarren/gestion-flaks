# Flaks Gestión

Plataforma de gestión interna de **Flaks** (agencia digital). La usan 2 personas: **German** y **Ezequiel**,
para organizar tareas, clientes, facturación, gastos, caja y documentación.

## Stack

- **Node.js + Express** (un único proceso sirve las vistas y las acciones).
- **Vistas**: server-side rendering con **EJS** + **Tailwind CSS** vía CDN (sin build step).
- **Base de datos**: **SQLite** con `node-sqlite3-wasm` (SQLite compilado a WebAssembly) — un único
  archivo en `data/flaks.sqlite`. API síncrona, **sin compilación nativa ni `node-gyp`**.
- **Sesiones**: `express-session` con un store propio sobre la misma base (tabla `sessions`).
- **Contraseñas**: hash con `bcryptjs` (equivalente en JS puro a `bcrypt`, sin compilación nativa).
- **Archivos**: `multer`, guardados en `storage/uploads/<categoria>/`.

> **Por qué `node-sqlite3-wasm` y no `better-sqlite3`**: el hosting compartido de Hostinger corre
> sobre glibc 2.28 y bloquea `node-gyp` (symlinks). `better-sqlite3` falla ahí con
> `GLIBC_2.29 not found` / `EACCES symlink python3`. `node-sqlite3-wasm` es 100% WebAssembly + JS:
> `npm install` no compila nada y funciona en cualquier hosting. `db/index.js` expone un adaptador
> con la misma interfaz (`prepare().get/all/run`, `exec`, `transaction`), así que el resto del código
> no cambia.
>
> Igual se descartó `connect-sqlite3` para las sesiones (arrastra otra dependencia nativa): el store
> vive en `lib/session-store.js`.

## Pantallas

1. **Login** — usuario + contraseña (sin registro público).
2. **Tareas** — vistas Hoy / Este mes / Todas, filtros por cliente, prioridad y estado, CRUD + completar.
3. **Clientes** — vista carpetas (tarjetas con color) o lista; activos vs. potenciales.
4. **Cliente (detalle)** — cobro mensual total, checklist de tareas del mes, trabajos recurrentes,
   trabajos únicos (ambos con reparto German/Ezequiel), anotaciones libres.
5. **Facturación** — planilla por mes/año: recurrentes activos + únicos del mes, totales y subtotal por persona.
6. **Gasto (carga)** — formulario: descripción, monto, tipo (recurrente/único), fecha, categoría.
7. **Gastos** — planilla por mes con total.
8. **Caja** — facturado − gastos = neto; reparto por persona; toggle para incluir clientes potenciales (proyección).
9. **Documentos** — subida de PDF / Word / TXT por categoría, opcionalmente asociados a un cliente; listar / descargar / eliminar.

Toda la interfaz está en español, moneda en **ARS** y fechas en formato **DD/MM/AAAA**.

### Auditoría

Cada alta / edición / baja en **Tareas, Clientes, Facturación y Gastos** queda registrada en la tabla
`audit_log` (usuario, entidad, id, acción, detalle, fecha). En cada registro se muestra
"Última modificación por X el DD/MM/AAAA HH:MM" y un historial completo desplegable.

## Puesta en marcha local

Requiere Node.js 18+.

```bash
npm install
cp .env.example .env      # y editar los valores (ver abajo)
npm run seed              # crea los usuarios y (opcional) datos de ejemplo
npm start                 # http://localhost:3000
```

### Variables de entorno (`.env`)

| Variable | Descripción |
|---|---|
| `PORT` | Puerto local. En Hostinger lo asigna la plataforma (`process.env.PORT`). |
| `NODE_ENV` | `production` en Hostinger (activa cookie segura + `trust proxy`). |
| `SESSION_SECRET` | Cadena larga y aleatoria para firmar la cookie de sesión. |
| `GERMAN_USERNAME` / `GERMAN_PASSWORD` | Credenciales iniciales de German (las toma el seed). |
| `EZEQUIEL_USERNAME` / `EZEQUIEL_PASSWORD` | Credenciales iniciales de Ezequiel. |
| `SEED_DEMO_DATA` | `true` para cargar 3 clientes de ejemplo con tareas y trabajos. |
| `GASTOS_REPARTO_GERMAN` | % de los gastos que se le descuenta a German en la Caja (`50` = 50/50). |

`npm run seed` es **idempotente**: si el usuario ya existe, actualiza su nombre y contraseña
(sirve para resetear una clave cambiando el `.env` y volviéndolo a correr). Los datos de ejemplo
sólo se cargan si todavía no hay ningún cliente.

## Despliegue en Hostinger (hPanel → "Setup Node.js App")

1. Subir el proyecto (por Git o por el administrador de archivos) **sin** `node_modules`, `.env` ni la carpeta `data/`.
2. En hPanel → **Website → Node.js**, crear la aplicación:
   - **Application root**: la carpeta del proyecto.
   - **Application startup file**: `server.js`.
   - **Node version**: 18 o superior.
3. En la sección de **variables de entorno** de esa pantalla, cargar las mismas claves del `.env`
   (`SESSION_SECRET`, credenciales del seed, `NODE_ENV=production`, `GASTOS_REPARTO_GERMAN`, etc.).
   No hace falta subir el archivo `.env`.
4. Ejecutar **Run NPM Install**.
5. Abrir la consola / terminal de la app y correr una sola vez:
   ```bash
   npm run seed
   ```
6. **Restart** la aplicación.

### Persistencia

- La base vive en `data/flaks.sqlite` (se crea sola) y los archivos en `storage/uploads/`.
- Ambas carpetas están **dentro del proyecto**, así que sobreviven a los reinicios.
- **No** borrar `data/` ni `storage/` en los redeploys. Para respaldar, copiar esas dos carpetas.
- `data/` y `storage/uploads/*` están en `.gitignore` para no versionar datos reales.

## Estructura

```
server.js            arranque de Express, sesión, montaje de rutas
db/
  schema.sql         esquema (se aplica solo al iniciar)
  index.js           conexión better-sqlite3
  seed.js            npm run seed
lib/
  format.js          moneda ARS, fechas DD/MM/AAAA, selector de período
  billing.js         armado de facturación / gastos / caja de un mes
  audit.js           registro en audit_log + historial
  session-store.js   store de sesiones sobre la base SQLite
middleware/auth.js   login obligatorio
routes/              tareas, clientes, facturacion, gastos, caja, documentos, auth
views/               EJS (layout + una carpeta por pantalla)
data/  storage/      datos persistentes (no versionar)
```

## Problemas comunes en el deploy

- **`GLIBC_2.29 not found` / `EACCES: permission denied, symlink '/usr/bin/python3'`**: es
  `better-sqlite3` intentando compilar. Este proyecto ya **no** lo usa (usa `node-sqlite3-wasm`).
  Si ves este error, asegurate de estar desplegando el commit actual y borrá el build anterior
  (en hPanel, "Clear build cache" o eliminá y recreá la app apuntando al repo).
- **La base "se reinicia" en cada deploy**: no debe pasar si `data/` no está en el repo. Verificá
  que `data/` esté en `.gitignore` y que no la hayas subido.
- **Errores de escritura tras un corte**: si quedó una carpeta `data/flaks.sqlite.lock`, la app la
  limpia sola al arrancar. Si persiste, borrala manualmente y reiniciá.

## Notas de seguridad

`npm audit` reporta 3 vulnerabilidades **moderadas** en `qs`/`body-parser` (transitivas de Express 4,
DoS teórico). Al ser una app interna detrás de login con 2 usuarios el riesgo es bajo; se puede
migrar a Express 5 más adelante.
