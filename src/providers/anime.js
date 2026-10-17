const log = require("../logger");
const anilist = require("./anilist");
const animeschedule = require("./animeschedule");
const { addAnimeRegions } = require("./animeRegions");

/**
 * Anime, from whichever schedule source is actually up.
 *
 * AniList stays the primary — it publishes a real per-episode airing schedule,
 * so its episode numbers are exact where the fallback's are counted from the
 * premiere. But it is a single point of failure, and when it went dark in
 * September 2026 ("temporarily disabled due to severe stability issues", HTTP
 * 403) the anime section simply emptied out while every other section kept
 * working. AnimeSchedule's open endpoints cover the same ground well enough to
 * keep the board populated, so we fall through to them rather than posting a
 * digest with no anime on it.
 *
 * Both providers return the same item shape, so nothing downstream needs to
 * know which one answered.
 */
const SOURCES = [
  { name: "anilist", fetch: anilist.fetchAnimeForDayKey },
  { name: "animeschedule", fetch: animeschedule.fetchAnimeForDayKey },
];

/**
 * How long to stay on the fallback before trying the primary again.
 *
 * An outage lasts hours or days, so re-trying AniList on every poll would just
 * buy a guaranteed failed request each time. Re-trying it *never* is worse: we
 * would sit on estimated episode numbers long after AniList came back. Half an
 * hour costs at most one wasted request per digest and picks the primary back
 * up on the first poll after it recovers.
 */
const PRIMARY_RETRY_MS = 30 * 60 * 1000;

let preferred = 0;
let lastPrimaryTry = 0;

function sourceOrder() {
  if (preferred === 0) return SOURCES;
  if (Date.now() - lastPrimaryTry >= PRIMARY_RETRY_MS) return SOURCES;
  return [...SOURCES.slice(preferred), ...SOURCES.slice(0, preferred)];
}

async function fetchAnimeForDayKey(dayKey) {
  const order = sourceOrder();
  const errors = [];

  for (const source of order) {
    const index = SOURCES.indexOf(source);
    if (index === 0) lastPrimaryTry = Date.now();

    try {
      const items = await source.fetch(dayKey);
      if (index !== preferred) {
        log.info("anime source switched", {
          from: SOURCES[preferred].name,
          to: source.name,
        });
        preferred = index;
      }
      return await addAnimeRegions(items);
    } catch (err) {
      errors.push(`${source.name}: ${err.message}`);
      log.error(`anime source failed (${source.name})`, err);
    }
  }

  throw new Error(`All anime sources failed — ${errors.join(" | ")}`);
}

/** Name of the source currently answering, for the weekly ops summary. */
function currentSource() {
  return SOURCES[preferred].name;
}

module.exports = { fetchAnimeForDayKey, currentSource };
