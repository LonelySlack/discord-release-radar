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

  CREATE TABLE IF NOT EXISTS poll_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ymd TEXT NOT NULL,
    at INTEGER NOT NULL,
    anime INTEGER DEFAULT 0,
    movies INTEGER DEFAULT 0,
    tv INTEGER DEFAULT 0,
    sent INTEGER DEFAULT 0,
    error TEXT
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

const insertPoll = db.prepare(`
  INSERT INTO poll_log (ymd, at, anime, movies, tv, sent, error)
  VALUES (@ymd, @at, @anime, @movies, @tv, @sent, @error)
`);

const recentPolls = db.prepare(`
  SELECT * FROM poll_log ORDER BY id DESC LIMIT ?
`);

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

/** Slot-aware key: digest:YYYY-MM-DD:morning|evening */
function digestId(ymd, slot) {
  return `digest:${ymd}:${slot}`;
}

function digestAlreadySent(ymd, slot) {
  if (alreadyNotified(digestId(ymd, slot))) return true;
  // Legacy single-daily key (pre twice-daily) counts as morning already sent
  if (slot === "morning" && alreadyNotified(`digest:${ymd}`)) return true;
  return false;
}

function markDigestSent(ymd, slot, title) {
  return markNotified(
    digestId(ymd, slot),
    "digest",
    title || `${slot} digest ${ymd}`
  );
}

function logPoll({ ymd, anime, movies, tv, sent, error }) {
  insertPoll.run({
    ymd,
    at: Date.now(),
    anime: anime || 0,
    movies: movies || 0,
    tv: tv || 0,
    sent: sent ? 1 : 0,
    error: error || null,
  });
}

function getRecentPolls(limit = 14) {
  return recentPolls.all(limit);
}

module.exports = {
  alreadyNotified,
  markNotified,
  getMetaValue,
  setMetaValue,
  digestAlreadySent,
  markDigestSent,
  logPoll,
  getRecentPolls,
};
