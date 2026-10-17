/**
 * Remembers showcases the feeds have announced.
 *
 * The feeds are shallow — the PlayStation Blog's carries about a day of posts,
 * because Sony publishes five times a day. So a State of Play announced last
 * Tuesday is invisible by Thursday, and the board goes back to predicting the
 * very show that already aired. That is the failure this exists to prevent: a
 * discovery is written down once and keeps counting long after the post that
 * carried it has scrolled away.
 *
 * Entries are pruned once they are far enough in the past that no estimate
 * could still collide with them, so this stays a handful of rows in `meta`.
 */
const { getMetaValue, setMetaValue } = require("./db");
const log = require("./logger");
const { localYmd, daysBetweenYmd } = require("./time");
const config = require("./config");

const KEY = "showcase:discovered";
/** Long enough to outlive any estimate for the same month, short enough to stay small. */
const KEEP_DAYS = 120;

function recallDiscovered(now = new Date()) {
  let stored;
  try {
    stored = JSON.parse(getMetaValue(KEY) || "[]");
  } catch (err) {
    log.error("showcase store unreadable", err);
    return [];
  }
  if (!Array.isArray(stored)) return [];

  const todayYmd = localYmd(config.timezone, now);
  return stored.filter(
    (e) => e?.date && daysBetweenYmd(e.date, todayYmd) <= KEEP_DAYS
  );
}

/**
 * Fold new discoveries into what we already knew. Returns the merged list so
 * the caller can use it directly — one event may be announced twice (a blog
 * post and a video), and series+date is the same showcase either way.
 */
function rememberDiscovered(events, now = new Date()) {
  const merged = [];
  const seen = new Set();

  for (const event of [...recallDiscovered(now), ...(events || [])]) {
    if (!event?.date) continue;
    const key = `${event.series || event.id}:${event.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Only the fields the calendar reads — the board is rebuilt from these,
    // and a stored blob shouldn't drift from what the renderer expects.
    merged.push({
      id: event.id,
      series: event.series,
      name: event.name,
      brand: event.brand,
      category: event.category,
      date: event.date,
      url: event.url,
      note: event.note,
      confirmed: true,
    });
  }

  try {
    setMetaValue(KEY, JSON.stringify(merged));
  } catch (err) {
    // A board built from live feeds alone is still a board.
    log.error("showcase store persist failed", err);
  }
  return merged;
}

module.exports = { recallDiscovered, rememberDiscovered, KEY };
