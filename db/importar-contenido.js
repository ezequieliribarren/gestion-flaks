'use strict';

/*
 * Importa (una sola vez) el histórico de links de historias de SISTEMA CONTINUO
 * desde db/contenido-historias.json, para que queden como "ya usados" y la
 * plataforma avise si se repiten.
 *
 * - Idempotente: marca en app_meta + además saltea links ya cargados.
 * - Corre solo al arrancar el server (server.js). Manual: npm run import-contenido
 */

const path = require('path');
const fs = require('fs');
const db = require('./index');
const { normalizarUrl } = require('../lib/contenido');

const MARCA = 'import_contenido_historias_v2';
const JSON_PATH = path.join(__dirname, 'contenido-historias.json');

function importarContenidoHistorico(log = console.log) {
  if (!fs.existsSync(JSON_PATH)) return false;
  if (db.prepare('SELECT valor FROM app_meta WHERE clave = ?').get(MARCA)) return false;

  const datos = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const nombreCliente = datos.cliente;

  let cliente = db.prepare('SELECT * FROM clientes WHERE lower(nombre) = lower(?)').get(nombreCliente);
  if (!cliente) {
    const info = db.prepare("INSERT INTO clientes (nombre, estado, redes, creado_por) VALUES (?, 'activo', 1, 'import-contenido')").run(nombreCliente);
    cliente = { id: info.lastInsertRowid, nombre: nombreCliente };
    log(`  Cliente "${nombreCliente}" creado.`);
  } else if (!cliente.redes) {
    db.prepare('UPDATE clientes SET redes = 1 WHERE id = ?').run(cliente.id);
  }

  log('--- Importando histórico de historias (SISTEMA CONTINUO) ---');

  const insTarea = db.prepare(`
    INSERT INTO tareas_contenido (cliente_id, tipo, titulo, estado, creado_por, ultima_modificacion_por, ultima_modificacion_en)
    VALUES (?, 'historias', ?, 'completada', 'import-contenido', 'import-contenido', datetime('now'))
  `);
  const insLink = db.prepare(`
    INSERT INTO contenido_links (tarea_id, cliente_id, url, url_norm, empresa, realizado, realizado_en, nota, creado_por)
    VALUES (@tarea_id, @cliente_id, @url, @url_norm, @empresa, 1, @realizado_en, @nota, 'import-contenido')
  `);

  const yaCargados = new Set(
    db.prepare('SELECT url_norm FROM contenido_links WHERE cliente_id = ?').all(cliente.id).map((r) => r.url_norm)
  );

  const correr = db.transaction(() => {
    let totalLinks = 0;
    for (const sub of datos.subempresas || []) {
      const links = (sub.links || []).filter((l) => {
        const n = normalizarUrl(l.url);
        return n && !yaCargados.has(n);
      });
      if (!links.length) continue;

      const tareaId = insTarea.run(cliente.id, `Historias — histórico importado (${sub.empresa})`).lastInsertRowid;
      for (const l of links) {
        const norm = normalizarUrl(l.url);
        yaCargados.add(norm);
        insLink.run({
          tarea_id: tareaId,
          cliente_id: cliente.id,
          url: l.url,
          url_norm: norm,
          empresa: sub.empresa || '',
          realizado_en: l.realizado_en || null,
          nota: l.nota || '',
        });
        totalLinks++;
      }
      log(`  ${sub.empresa}: ${links.length} links.`);
    }
    db.prepare('INSERT OR REPLACE INTO app_meta (clave, valor) VALUES (?, ?)').run(MARCA, new Date().toISOString());
    return totalLinks;
  });

  const n = correr();
  log(`  Total: ${n} links marcados como usados.`);
  log('----------------------------------------------------------');
  return true;
}

module.exports = { importarContenidoHistorico };

if (require.main === module) {
  const hizo = importarContenidoHistorico(console.log);
  if (!hizo) console.log('El histórico de contenido ya estaba importado (o falta el JSON).');
}
