// 数据库初始化 — SQLite (via sql.js)
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'health.db');

if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      local_id INTEGER NOT NULL,
      ts TEXT NOT NULL,
      date TEXT NOT NULL,
      scores TEXT NOT NULL,
      causes TEXT,
      sugg TEXT,
      weather TEXT,
      modifiers TEXT,
      raw_scores TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, local_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS behavior_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      session_id TEXT,
      client_ts INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  db.run('CREATE INDEX IF NOT EXISTS idx_assessments_user ON assessments(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_assessments_date ON assessments(user_id, date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_behavior_user ON behavior_logs(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_behavior_action ON behavior_logs(user_id, action)');

  saveDb();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function run(sql, params) {
  db.run(sql, params);
  saveDb();
  const result = db.exec('SELECT last_insert_rowid()');
  return {
    lastInsertRowid: result[0] ? result[0].values[0][0] : 0,
    changes: db.getRowsModified()
  };
}

function get(sql, params) {
  const stmt = db.prepare(sql);
  if (params && params.length) stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params) {
  const stmt = db.prepare(sql);
  if (params && params.length) stmt.bind(params);
  const result = [];
  while (stmt.step()) {
    result.push(stmt.getAsObject());
  }
  stmt.free();
  return result;
}

module.exports = { getDb, saveDb, run, get, all };
