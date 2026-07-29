const fs = require("fs");
const Database = require("better-sqlite3");
const config = require("./config");

if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT,
    notified_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

const insertNotif = db.prepare(`
  INSERT OR IGNORE INTO notifications (id, kind, title, notified_at)
  VALUES (@id, @kind, @title, @notified_at)
`);

const hasNotif = db.prepare(`SELECT 1 FROM notifications WHERE id = ?`);

const setMeta = db.prepare(`
  INSERT INTO meta (key, value) VALUES (@key, @value)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

const getMeta = db.prepare(`SELECT value FROM meta WHERE key = ?`);

function alreadyNotified(id) {
  return Boolean(hasNotif.get(id));
}

function markNotified(id, kind, title) {
  const result = insertNotif.run({
    id,
    kind,
    title: title || "",
    notified_at: Date.now(),
  });
  return result.changes > 0;
}

function getMetaValue(key, fallback = null) {
  const row = getMeta.get(key);
  return row ? row.value : fallback;
}

function setMetaValue(key, value) {
  setMeta.run({ key, value: String(value) });
}

module.exports = {
  alreadyNotified,
  markNotified,
  getMetaValue,
  setMetaValue,
};
