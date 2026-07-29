const config = require("../config");
const { formatAvailability } = require("../utils/matchServices");

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
  // flatrate + free + ads = "subscription-ish"; skip pure rent/buy for radar
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
  // mediaType: movie | tv
  const data = await tmdb(`/${mediaType}/${id}/watch/providers`);
  const results = data.results || {};
  const byRegion = {};

  const regions = [
    config.primaryRegion,
    ...config.fallbackRegions.filter((r) => r !== config.primaryRegion),
  ];

  for (const region of regions) {
    const entry = results[region];
    if (entry) {
      byRegion[region] = providerNamesFromResults(entry);
    } else {
      byRegion[region] = [];
    }
  }

  return byRegion;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysFromNowISO(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Movies released "today" (UTC) that appear on discovery with release date.
 * TMDB rarely has exact hour — we notify on the day data is available.
 */
async function fetchNewMovies() {
  const today = todayISO();
  // Discover movies with primary release date = today, sorted by popularity
  const data = await tmdb("/discover/movie", {
    "primary_release_date.gte": today,
    "primary_release_date.lte": today,
    sort_by: "popularity.desc",
    include_adult: "false",
    page: 1,
  });

  const items = data.results || [];
  const out = [];

  // Cap to keep droplet light
  for (const movie of items.slice(0, 15)) {
    const byRegion = await fetchWatchProviders("movie", movie.id);
    const availability = formatAvailability(
      byRegion,
      config.primaryRegion,
      config.fallbackRegions,
      config.services
    );

    // Only notify if it hits at least one of the user's services somewhere
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
      timingLabel: "Released today (catalog date)",
    });

    // Small delay to be nice to TMDB free tier
    await sleep(120);
  }

  return out;
}

/**
 * TV: episodes airing today (via /tv/airing_today) filtered by your services.
 * Exact episode clock times are not always present — notify when listed for today.
 */
async function fetchAiringTv() {
  const data = await tmdb("/tv/airing_today", {
    page: 1,
    language: "en-US",
  });

  const items = data.results || [];
  const out = [];
  const today = todayISO();

  for (const show of items.slice(0, 15)) {
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
      timingLabel: "On today's airing list",
    });

    await sleep(120);
  }

  return out;
}

/**
 * Newly available streaming titles are hard without JustWatch paid API.
 * Heuristic: popular titles first aired / released in the last 3 days
 * that are on your services in MY or fallback regions.
 */
async function fetchRecentlyAvailable() {
  const gte = daysFromNowISO(-3);
  const lte = todayISO();

  const movieData = await tmdb("/discover/movie", {
    "primary_release_date.gte": gte,
    "primary_release_date.lte": lte,
    sort_by: "popularity.desc",
    include_adult: "false",
    page: 1,
  });

  const out = [];
  for (const movie of (movieData.results || []).slice(0, 10)) {
    // Skip pure "today" which fetchNewMovies already covers
    if (movie.release_date === lte) continue;

    const byRegion = await fetchWatchProviders("movie", movie.id);
    const availability = formatAvailability(
      byRegion,
      config.primaryRegion,
      config.fallbackRegions,
      config.services
    );
    if (!availability.hasAny) continue;

    out.push({
      id: `movie-recent:${movie.id}:${movie.release_date || lte}`,
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
      timingLabel: "Recent theatrical / catalog release",
    });
    await sleep(120);
  }

  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  fetchNewMovies,
  fetchAiringTv,
  fetchRecentlyAvailable,
};
