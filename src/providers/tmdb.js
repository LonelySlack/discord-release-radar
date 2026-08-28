const config = require("../config");
const { formatAvailability, matchServices } = require("../utils/matchServices");
const { localYmd, ymdForDay, dayWord } = require("../time");
const log = require("../logger");

const BASE = "https://api.themoviedb.org/3";

async function tmdb(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("api_key", config.tmdbApiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDB ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function providerNamesFromResults(watchProvidersPayload) {
  const buckets = ["flatrate", "free", "ads"];
  const names = new Set();
  for (const key of buckets) {
    for (const p of watchProvidersPayload?.[key] || []) {
      if (p.provider_name) names.add(p.provider_name);
    }
  }
  return [...names];
}

async function fetchWatchProviders(mediaType, id) {
  const data = await tmdb(`/${mediaType}/${id}/watch/providers`);
  const results = data.results || {};
  const byRegion = {};

  const regions = [
    config.primaryRegion,
    ...config.fallbackRegions.filter((r) => r !== config.primaryRegion),
  ];

  // TMDB only exposes one "where to watch" page per region (JustWatch), not
  // per-service deep links — so we keep that single link per region.
  const linkByRegion = {};

  for (const region of regions) {
    const entry = results[region];
    byRegion[region] = entry ? providerNamesFromResults(entry) : [];
    if (entry?.link) linkByRegion[region] = entry.link;
  }

  byRegion.__links = linkByRegion;
  return byRegion;
}

function todayLocal() {
  return localYmd(config.timezone);
}

/** Wording that reads right on each calendar tab. */
const TV_TIMING = {
  yesterday: "Aired yesterday",
  today: "Airing today",
  tomorrow: "Airing tomorrow",
};

/**
 * TMDB provider ids for the services in config/services.json, for the primary
 * region. Resolved from TMDB's own directory rather than hard-coded, so
 * services.json stays the single place you list what you subscribe to.
 * Cached for a day — the directory changes about never.
 */
const PROVIDER_TTL_MS = 24 * 60 * 60 * 1000;
let providerCache = { ids: null, at: 0 };

async function serviceProviderIds() {
  if (providerCache.ids && Date.now() - providerCache.at < PROVIDER_TTL_MS) {
    return providerCache.ids;
  }

  const data = await tmdb("/watch/providers/movie", {
    watch_region: config.primaryRegion,
  });

  const ids = [];
  const names = [];
  for (const p of data.results || []) {
    if (!p.provider_id || !p.provider_name) continue;
    if (!matchServices([p.provider_name], config.services).length) continue;
    ids.push(p.provider_id);
    names.push(p.provider_name);
  }

  providerCache = { ids, at: Date.now() };
  log.info("tmdb providers resolved", {
    region: config.primaryRegion,
    count: ids.length,
    names,
  });
  return ids;
}

function daysAgoLocal(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localYmd(config.timezone, d);
}

/**
 * Movies newly available to stream on your services.
 *
 * TMDB exposes no "added to Netflix on <date>" field, so asking for films
 * *released* on one calendar day and already streaming returns nothing — a film
 * released today is in cinemas, not on a subscription. Instead we ask the
 * question the data can answer: recent releases that are on your services right
 * now, newest first. That makes this a rolling window like cinema and games
 * rather than something the day tabs slice.
 */
async function fetchNewOnServices() {
  const today = todayLocal();
  const since = daysAgoLocal(config.movieWindowDays);

  const providerIds = await serviceProviderIds();
  if (!providerIds.length) {
    log.warn("no TMDB providers matched services.json; using popularity fallback");
    return fetchRecentPopularOnServices(since, today);
  }

  const params = {
    watch_region: config.primaryRegion,
    with_watch_providers: providerIds.join("|"),
    // Subscription only: without this, anything rentable on the Apple TV store
    // counts as "on your services".
    with_watch_monetization_types: "flatrate",
    "primary_release_date.gte": since,
    "primary_release_date.lte": today,
    // Newest first so the section actually turns over day to day; a popularity
    // sort would show the same big titles for weeks.
    sort_by: "primary_release_date.desc",
    include_adult: "false",
  };

  // Newest-first drags in a long tail of filler, so over-fetch and let the
  // popularity floor do the curating.
  const candidates = [];
  for (let page = 1; page <= 3; page += 1) {
    const data = await tmdb("/discover/movie", { ...params, page });
    const results = data.results || [];
    candidates.push(
      ...results.filter((m) => (m.popularity || 0) >= config.movieMinPopularity)
    );
    if (candidates.length >= config.maxMovies) break;
    if (page >= (data.total_pages || 1)) break;
  }

  const out = [];
  for (const movie of candidates.slice(0, config.maxMovies)) {
    // We already know it's on a tracked service; this call is for the names and
    // the region "where to watch" link the digest line shows.
    const byRegion = await fetchWatchProviders("movie", movie.id);
    const availability = formatAvailability(
      byRegion,
      config.primaryRegion,
      config.fallbackRegions,
      config.services
    );

    out.push(buildMovie(movie, availability, today));
    await sleep(120);
  }

  log.info("tmdb movies streaming", { since, today, count: out.length });
  return out;
}

/**
 * Fallback for when no provider id matches services.json: ask for recent
 * popular films and filter on the watch-provider payload instead. Slower and
 * broader, but it still answers "what can I actually watch".
 */
async function fetchRecentPopularOnServices(since, today) {
  const data = await tmdb("/discover/movie", {
    "primary_release_date.gte": since,
    "primary_release_date.lte": today,
    sort_by: "popularity.desc",
    include_adult: "false",
    page: 1,
  });

  const out = [];
  for (const movie of data.results || []) {
    if (out.length >= config.maxMovies) break;

    const byRegion = await fetchWatchProviders("movie", movie.id);
    const availability = formatAvailability(
      byRegion,
      config.primaryRegion,
      config.fallbackRegions,
      config.services
    );
    if (!availability.hasAny) continue;

    out.push(buildMovie(movie, availability, today));
    await sleep(120);
  }

  log.info("tmdb movies streaming (fallback)", { since, today, count: out.length });
  return out;
}

function buildMovie(movie, availability, today) {
  const date = movie.release_date || null;
  return {
    id: `movie:${movie.id}:${date || today}`,
    kind: "movie",
    // A rolling window, not one calendar day — shown on every tab.
    day: "any",
    title: movie.title || movie.original_title || "Untitled movie",
    subtitle: date ? `Released ${date}` : "New on your services",
    url: `https://www.themoviedb.org/movie/${movie.id}`,
    image: movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : null,
    color: "#E50914",
    overview: movie.overview || "",
    rating: movie.vote_average ? movie.vote_average.toFixed(1) : null,
    releaseDate: date,
    availability,
    timingLabel: "New to stream",
  };
}

/**
 * TV with an episode airing on the given calendar day, filtered to your
 * services. /tv/airing_today only ever knows about "now", so the board uses
 * /discover/tv with an explicit air-date window — that answers yesterday and
 * tomorrow with the same query.
 */
async function fetchTvForDay(dayKey) {
  const ymd = ymdForDay(config.timezone, dayKey);
  const data = await tmdb("/discover/tv", {
    "air_date.gte": ymd,
    "air_date.lte": ymd,
    sort_by: "popularity.desc",
    timezone: config.timezone,
    include_null_first_air_dates: "false",
    language: "en-US",
    page: 1,
  });

  const items = data.results || [];
  const out = [];

  for (const show of items.slice(0, config.maxTv)) {
    const byRegion = await fetchWatchProviders("tv", show.id);
    const availability = formatAvailability(
      byRegion,
      config.primaryRegion,
      config.fallbackRegions,
      config.services
    );

    if (!availability.hasAny) continue;

    out.push({
      id: `tv:${show.id}:${ymd}`,
      kind: "tv",
      day: dayKey,
      title: show.name || show.original_name || "Untitled show",
      subtitle: `Episode airing ${dayWord(dayKey)}`,
      url: `https://www.themoviedb.org/tv/${show.id}`,
      image: show.poster_path
        ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
        : null,
      color: "#1CE783",
      overview: show.overview || "",
      rating: show.vote_average ? show.vote_average.toFixed(1) : null,
      releaseDate: ymd,
      availability,
      timingLabel: TV_TIMING[dayKey] || `Airing ${ymd}`,
    });

    await sleep(120);
  }

  log.info(`tmdb tv ${dayKey}`, { ymd, count: out.length });
  return out;
}

/**
 * Movies coming to CINEMAS soon in the primary region (theatrical, not streaming).
 * e.g. "Spider-Man: Brand New Day", "The Odyssey". No watch-provider filter —
 * these aren't on your subscriptions yet, the point is the theatrical date.
 */
async function fetchUpcomingCinema() {
  const today = todayLocal();
  const until = daysFromNowLocal(config.cinemaWindowDays);

  // discover with a theatrical release-type filter, scoped to the region so the
  // dates reflect the local cinema calendar.
  const data = await tmdb("/discover/movie", {
    region: config.primaryRegion,
    "primary_release_date.gte": today,
    "primary_release_date.lte": until,
    with_release_type: "3|2", // 3 = theatrical, 2 = limited theatrical
    sort_by: "popularity.desc",
    include_adult: "false",
    page: 1,
  });

  const items = data.results || [];
  const out = [];

  for (const movie of items.slice(0, config.maxCinema)) {
    const date = movie.release_date || null;
    out.push({
      id: `cinema:${movie.id}:${date || until}`,
      kind: "cinema",
      day: "any",
      title: movie.title || movie.original_title || "Untitled film",
      subtitle: date ? `In cinemas ${date}` : "Coming to cinemas",
      url: `https://www.themoviedb.org/movie/${movie.id}`,
      image: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      color: "#FFB300",
      overview: movie.overview || "",
      rating: movie.vote_average ? movie.vote_average.toFixed(1) : null,
      releaseDate: date,
      timingLabel: date ? `🎟️ ${date}` : "Coming soon",
    });
  }

  log.info("tmdb cinema upcoming", { today, until, count: out.length });
  return out;
}

function daysFromNowLocal(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localYmd(config.timezone, d);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  fetchNewOnServices,
  fetchTvForDay,
  fetchUpcomingCinema,
};
