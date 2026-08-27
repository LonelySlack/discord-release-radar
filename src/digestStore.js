/**
 * Remembers the data behind each posted digest message so the filter buttons
 * can re-render it (ephemerally) when someone clicks. In-memory only: if the
 * bot restarts, old buttons just report "expired" — the next digest is fresh.
 */
const MAX_ENTRIES = 40;
const store = new Map(); // messageId -> { releases, ymd, slot, ts }

function remember(messageId, payload) {
  store.set(messageId, { ...payload, ts: Date.now() });
  // Evict oldest if we grow past the cap.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

function recall(messageId) {
  return store.get(messageId) || null;
}

module.exports = { remember, recall };
