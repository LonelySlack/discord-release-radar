const config = require("../config");
const log = require("../logger");
const { formatAvailability } = require("../utils/matchServices");
const { tmdb, fetchWatchProviders } = require("./tmdb");

/**
 * Which countries can stream each anime.
 *
 * AniList links a show to Crunchyroll or Netflix but never says where those
 * links work, and a Crunchyroll title that plays in the US is often blocked in
 * MY. TMDB carries per-country streaming data (from JustWatch), so we find the
 * show there and attach the same `availability` the TV rows use. That lets the
 * row say "🇲🇾 Netflix" or "🌍 US · Crunchyroll" — the country to VPN to.
 *
 * TMDB files every season under one show while AniList splits them, so a
 * season suffix is stripped before searching. A show TMDB doesn't know keeps
 * its AniList link and simply gets no country.
 */

/** Lookups are cached per show: availability rarely changes within a day. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();

const CONCURRENCY = 4;
const ANIMATION_GENRE = 16;

/** "Frieren Season 2", "Dr. Stone: Science Future Part 3" -> the show's base name. */
function baseTitle(title) {
  return title
    .replace(/\s*[:\-–]?\s*(season|part|cour)\s*\d+.*$/i, "")
    .replace(/\s+\d+(st|nd|rd|th)\s+season.*$/i, "")
    .replace(/\s+(II|III|IV|2|3|4)$/i, "")
    .trim();
}

function searchTerms(item) {
  const terms = [];
  for (const t of [item.title, item.romajiTitle, item.nativeTitle]) {
    if (!t) continue;
    terms.push(t);
    const base = baseTitle(t);
    if (base && base !== t) terms.push(base);
  }
  return [...new Set(terms)];
}

async function findTmdbShow(item) {
  for (const query of searchTerms(item)) {
    const data = await tmdb("/search/tv", { query, include_adult: "false" });
    const hit = (data.results || []).find((r) =>
      (r.genre_ids || []).includes(ANIMATION_GENRE)
    );
    if (hit) return hit.id;
  }
  return null;
}

async function lookup(item) {
  const key = item.mediaId || item.title;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.availability;

  let availability = null;
  const showId = await findTmdbShow(item);
  if (showId) {
    const byRegion = await fetchWatchProviders("tv", showId);
    // The row links to the anime's own page, not TMDB's watch page.
    delete byRegion.__links;
    const found = formatAvailability(
      byRegion,
      config.primaryRegion,
      config.fallbackRegions,
      config.services
    );
    if (found.hasAny) availability = found;
  }

  cache.set(key, { availability, at: Date.now() });
  return availability;
}

/**
 * Attach `availability` to each anime item in place. Never throws: a TMDB
 * failure costs the country labels, not the anime section.
 */
async function addAnimeRegions(items) {
  if (!items.length) return items;

  let found = 0;
  let failed = 0;
  const queue = [...items];

  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      try {
        item.availability = await lookup(item);
        if (item.availability) found += 1;
      } catch (err) {
        failed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log.info("anime regions", { items: items.length, found, failed });
  return items;
}

module.exports = { addAnimeRegions, baseTitle };
