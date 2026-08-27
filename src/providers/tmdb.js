const config = require("../config");
const { formatAvailability } = require("../utils/matchServices");
const { localYmd } = require("../time");
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

  for (const region of regions) {
    const entry = results[region];
    byRegion[region] = entry ? providerNamesFromResults(entry) : [];
  }

  return byRegion;
}

function todayLocal() {
  return localYmd(config.timezone);
}

function daysAgoLocal(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localYmd(config.timezone, d);
}

/**
 * Movies with primary release date = local today, on your services.
 */
async function fetchNewMovies() {
  const today = todayLocal();
  const data = await tmdb("/discover/movie", {
    "primary_release_date.gte": today,
    "primary_release_date.lte": today,
    sort_by: "popularity.desc",
    include_adult: "false",
    page: 1,
  });

  const items = data.results || [];
  const out = [];

  for (const movie of items.slice(0, config.maxMovies)) {
    const byRegion = await fetchWatchProviders("movie", movie.id);
    const availability = formatAvailability(
      byRegion,
      config.primaryRegion,
      config.fallbackRegions,
      config.services
    );

    if (!availability.hasAny) continue;

    out.push({
      id: `movie:${movie.id}:${today}`,
      kind: "movie",
      title: movie.title || movie.original_title || "Untitled movie",
      subtitle: movie.release_date ? `Released ${movie.release_date}` : "New movie",
      url: `https://www.themoviedb.org/movie/${movie.id}`,
      image: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      color: "#E50914",
      overview: movie.overview || "",
      rating: movie.vote_average ? movie.vote_average.toFixed(1) : null,
      availability,
      timingLabel: "Released today",
    });

    await sleep(120);
  }

  log.info("tmdb movies today", { today, count: out.length });
  return out;
}

/**
 * TV airing today (TMDB list), filtered to your services.
 */
async function fetchAiringTv() {
  const today = todayLocal();
  const data = await tmdb("/tv/airing_today", {
    page: 1,
    language: "en-US",
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
      id: `tv:${show.id}:${today}`,
      kind: "tv",
      title: show.name || show.original_name || "Untitled show",
      subtitle: "Episode airing today",
      url: `https://www.themoviedb.org/tv/${show.id}`,
      image: show.poster_path
        ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
        : null,
      color: "#1CE783",
      overview: show.overview || "",
      rating: show.vote_average ? show.vote_average.toFixed(1) : null,
      availability,
      timingLabel: "Airing today",
    });

    await sleep(120);
  }

  log.info("tmdb tv today", { today, count: out.length });
  return out;
}

/**
 * Recent movies (last 2 local days, not today) still useful for a morning digest.
 */
async function fetchRecentlyAvailable() {
  const today = todayLocal();
  const gte = daysAgoLocal(2);

  const movieData = await tmdb("/discover/movie", {
    "primary_release_date.gte": gte,
    "primary_release_date.lte": today,
    sort_by: "popularity.desc",
    include_adult: "false",
    page: 1,
  });

  const out = [];
  for (const movie of (movieData.results || []).slice(0, 8)) {
    if (movie.release_date === today) continue;

    const byRegion = await fetchWatchProviders("movie", movie.id);
    const availability = formatAvailability(
      byRegion,
      config.primaryRegion,
      config.fallbackRegions,
      config.services
    );
    if (!availability.hasAny) continue;

    out.push({
      id: `movie-recent:${movie.id}:${movie.release_date || today}`,
      kind: "movie",
      title: movie.title || movie.original_title || "Untitled movie",
      subtitle: movie.release_date
        ? `Recent release (${movie.release_date})`
        : "Recent release",
      url: `https://www.themoviedb.org/movie/${movie.id}`,
      image: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      color: "#E50914",
      overview: movie.overview || "",
      rating: movie.vote_average ? movie.vote_average.toFixed(1) : null,
      availability,
      timingLabel: "Recent release",
    });
    await sleep(120);
  }

  log.info("tmdb movies recent", { gte, today, count: out.length });
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
  fetchNewMovies,
  fetchAiringTv,
  fetchRecentlyAvailable,
  fetchUpcomingCinema,
};
