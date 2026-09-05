'use strict';

// Store de sesiones para express-session usando better-sqlite3.
// Evita sumar una segunda dependencia nativa (connect-sqlite3 arrastra sqlite3).

const db = require('../db');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid    TEXT PRIMARY KEY,
    expira INTEGER NOT NULL,
    data   TEXT NOT NULL
  );
`);

const stmts = {
  get: db.prepare('SELECT data, expira FROM sessions WHERE sid = ?'),
  set: db.prepare('INSERT INTO sessions (sid, expira, data) VALUES (@sid, @expira, @data) ON CONFLICT(sid) DO UPDATE SET expira = @expira, data = @data'),
  destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
  purge: db.prepare('DELETE FROM sessions WHERE expira < ?'),
};

function build(session) {
  const Store = session.Store;

  class SQLiteStore extends Store {
    constructor(options = {}) {
      super(options);
      const cada = options.limpiezaMs || 1000 * 60 * 60; // 1 h
      this._timer = setInterval(() => {
        try { stmts.purge.run(Date.now()); } catch (e) { /* noop */ }
      }, cada);
      if (this._timer.unref) this._timer.unref();
    }

    get(sid, cb) {
      try {
        const row = stmts.get.get(sid);
        if (!row) return cb(null, null);
        if (row.expira < Date.now()) {
          stmts.destroy.run(sid);
          return cb(null, null);
        }
        return cb(null, JSON.parse(row.data));
      } catch (err) {
        return cb(err);
      }
    }

    set(sid, sess, cb) {
      try {
        const expira = sess.cookie && sess.cookie.expires
          ? new Date(sess.cookie.expires).getTime()
          : Date.now() + 1000 * 60 * 60 * 24;
        stmts.set.run({ sid, expira, data: JSON.stringify(sess) });
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }

    destroy(sid, cb) {
      try {
        stmts.destroy.run(sid);
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }

    touch(sid, sess, cb) {
      return this.set(sid, sess, cb);
    }
  }

  return SQLiteStore;
}

module.exports = build;
