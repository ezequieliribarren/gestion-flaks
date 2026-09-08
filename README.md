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
2b. **Contenido** — módulo para los clientes de **redes sociales**. Lista sólo los clientes marcados
   con "redes". Cada uno tiene su **plan**, un link a su **Google Sheet de planificación** (lo carga
   un admin) y sus **tareas de contenido** (historias, reels, posteos…). Una tarea de contenido es
   una "hoja" donde se pegan links (uno o varios a la vez); cada link tiene un tilde **Realizado** y
   la plataforma **avisa si ese link ya se usó antes** (en este cliente o en otro) y en qué fecha,
   para que no se repita. Se puede compartir con un **usuario que sólo ve Contenido** (ver más abajo).
3. **Clientes** — vista carpetas o lista; **logo** opcional por cliente (si no hay, se muestran las
   iniciales); cambio rápido de estado desde la lista; estado **activo / potencial / inactivo** con filtro
   (por defecto **Activos**) y orden **A→Z** o **mayor facturación**. Los **inactivos** no cuentan
   en la facturación del mes en curso (sí sus cobros históricos); los **potenciales** sólo en la
   proyección. Un cliente inactivo con un trabajo único **potencial** figura como potencial hasta
   que ese trabajo se confirme.
4. **Cliente (detalle)** — cobro mensual total, checklist de tareas del mes, trabajos recurrentes,
   trabajos únicos (ambos con reparto German/Ezequiel), anotaciones libres.
5. **Facturación** — planilla por mes/año: recurrentes activos + únicos del mes, totales y subtotal por persona.
6. **Gasto (carga)** — formulario: descripción, monto, tipo (recurrente/único), fecha, categoría,
   **quién lo pagó** (German/Ezequiel) y **¿Saldado? Sí/No** (obligatorio).
7. **Gastos** — planilla por mes + **cuenta corriente**: los gastos "no saldados" (los pagó uno solo
   y todavía no se compensó) suman a la cuenta corriente; la pantalla muestra cuánto puso cada uno,
   quién tiene saldo a favor y un botón **"Registrar pago y saldar"** que compensa la diferencia,
   deja registro del pago y recién ahí esos gastos pasan a Caja.
8. **Caja** — facturado − gastos **saldados** = neto; reparto por persona; avisa si hay gastos sin
   saldar (no incluidos hasta compensarlos); toggle para incluir clientes potenciales (proyección).
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
5. **Restart** la aplicación.

Al arrancar, la app **crea/actualiza sola** a German y Ezequiel con las variables de entorno
(no hace falta correr nada a mano). En los logs de la app vas a ver algo como:

```
--- Sincronizando usuarios desde variables de entorno ---
+ Usuario creado: "german" (largo de contraseña: 12)
+ Usuario creado: "ezequiel" (largo de contraseña: 12)
Usuarios en la base: 2
```

Si el "largo de contraseña" no coincide con lo que esperás, revisá el valor en el panel
(espacios de más, comillas). Para **cambiar una contraseña**: editás la variable y **Restart**.

`npm run seed` (en la terminal de la app) sigue existiendo y además carga los datos de ejemplo
si `SEED_DEMO_DATA=true`.

### Usuario que sólo ve "Contenido"

Se crea igual que German y Ezequiel: con **variables de entorno**.

| Variable | Descripción |
|---|---|
| `CONTENIDO_USERNAME` | Usuario para loguearse. |
| `CONTENIDO_PASSWORD` | Contraseña. |
| `CONTENIDO_NOMBRE` | Nombre a mostrar (opcional, por defecto "Contenido"). |

Si las cargás y hacés **Restart**, la app crea ese usuario con rol `contenido`: al entrar sólo ve el
módulo **Contenido** (cualquier otra URL lo redirige ahí) y no puede tocar el plan ni el link del
Sheet de cada cliente (eso queda para los admin). German y Ezequiel quedan como rol `admin`.

Si no las cargás, ese usuario simplemente no existe. Para agregar más usuarios de contenido en el
futuro hay que sumar otra tanda de variables (o pasar a un alta de usuarios desde la interfaz).

### Datos históricos de la planilla anterior

`db/datos-iniciales.json` tiene los clientes, la facturación (trabajos únicos) y los gastos
extraídos de la planilla vieja (`anterior/TODO MARCADOR.xlsx`). Al arrancar, la app los importa
**una sola vez** (deja una marca en `app_meta`). Todo lo importado queda con
`creado_por = 'import-xlsx'`.

- `npm run import` → importa si todavía no se hizo.
- `npm run import -- --reset` → borra lo importado (clientes/trabajos/gastos con esa marca) y
  vuelve a importar. No toca nada cargado a mano por German o Ezequiel.
- `npm run generar-datos` → regenera el JSON desde el `.xlsx` (requiere la devDependency `xlsx`
  y el archivo en `anterior/`).

Los trabajos sin reparto German/Ezequiel en la planilla se importan 50/50. Los clientes marcados
como "mensuales" quedan con una nota para cargarles el trabajo recurrente con su monto. Los
egresos de tipo honorarios/retiros no se importan como gasto (falsearían la ganancia de la Caja).

### Histórico de historias (SISTEMA CONTINUO)

`db/contenido-historias.json` tiene los links de historias ya usados de SISTEMA CONTINUO, sacados
del sheet de la CM (`anterior/HISTORIAS JULI - *.csv`, columnas A = link, B = producto). Al arrancar,
la app los importa **una sola vez**: marca al cliente como "redes", crea una tarea de contenido
"histórico importado" y carga los 54 links como **realizados** con su fecha aproximada (por semana)
y la sub-empresa. Sirven de "memoria": si alguien pega uno de esos links, avisa que ya se usó.

- `npm run generar-contenido` → regenera el JSON desde los CSV de `anterior/` (dev, requiere `xlsx`).
- `npm run import-contenido` → importa si todavía no se hizo.

### Persistencia — IMPORTANTE

La base (`flaks.sqlite`) y los documentos subidos **no** están en git. Si el deploy por Git de
Hostinger **reemplaza la carpeta del proyecto en cada push** (build en `hbuilds/…`), entonces
`data/` y `storage/` se borran en cada deploy y se pierde todo lo cargado desde el dashboard.

**Solución (hacerlo sí o sí en Hostinger):** guardar los datos FUERA de la carpeta del proyecto y
apuntar la app con dos variables de entorno:

| Variable | Valor (ejemplo) |
|---|---|
| `FLAKS_DATA_DIR` | `/home/uXXXXXXXX/flaks-datos` |
| `FLAKS_STORAGE_DIR` | `/home/uXXXXXXXX/flaks-storage` |

Creá esas dos carpetas una vez (con el Administrador de archivos, al lado de `domains/`, no dentro
del proyecto) y cargá las variables. La app crea ahí `flaks.sqlite` y guarda los documentos, y ya
**ningún deploy las toca**. En los logs, al arrancar, imprime `Datos en: …` y `Documentos en: …`
para que confirmes la ruta.

Si NO se definen, usa `./data` y `./storage` dentro del proyecto (bien para desarrollo local o
para hostings que sí preservan esas carpetas).

**Respaldo:** copiar la carpeta `FLAKS_DATA_DIR` (o `data/`). Es un único archivo `.sqlite`.

- `data/`, `storage/uploads/*` y `anterior/` están en `.gitignore`.
- El import de `db/datos-iniciales.json` corre **una sola vez** (marca en `app_meta`); sobre una
  base existente nunca pisa lo cargado a mano. Si la base se recrea vacía (deploy que borró
  `data/`), el import vuelve a correr y por eso "vuelven" los datos viejos.

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
