/**
 * Remembers the data behind each posted digest so its tabs and page arrows can
 * re-render it when someone clicks. Kept in memory for speed and mirrored into
 * the meta table, so the buttons still work after a restart — without that, a
 * redeploy would strand every posted board on page 1.
 */
const { getMetaValue, setMetaValue } = require("./db");
const log = require("./logger");

const MAX_ENTRIES = 40;
/**
 * Fields we carry but never render. The board now holds three days of items, so
 * dropping the long synopsis keeps a remembered digest a few KB rather than
 * tens — this whole map is mirrored into one sqlite row on every post.
 */
const UNUSED_FIELDS = ["overview"];
const KEY = "digest:views";
const store = new Map(); // messageId -> { releases, ymd, slot, ts }

function persist() {
  try {
    setMetaValue(KEY, JSON.stringify([...store.entries()]));
  } catch (err) {
    // A board that only works until the next restart beats a crashed digest.
    log.error("digest store persist failed", err);
  }
}

function load() {
  try {
    const raw = getMetaValue(KEY);
    if (!raw) return;
    for (const [id, payload] of JSON.parse(raw)) store.set(id, payload);
    log.info("digest store loaded", { entries: store.size });
  } catch (err) {
    log.error("digest store load failed", err);
  }
}

/** Drop the payload weight the renderer never reads. */
function slim(payload) {
  if (!Array.isArray(payload.releases)) return payload;
  const releases = payload.releases.map((item) => {
    const copy = { ...item };
    for (const field of UNUSED_FIELDS) delete copy[field];
    return copy;
  });
  return { ...payload, releases };
}

function remember(messageId, payload) {
  store.set(messageId, { ...slim(payload), ts: Date.now() });
  // Evict oldest if we grow past the cap.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
  persist();
}

function recall(messageId) {
  return store.get(messageId) || null;
}

load();

module.exports = { remember, recall };
