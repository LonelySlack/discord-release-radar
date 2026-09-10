const config = require("../config");
const { dayBounds, formatLocalTime, dateForDay } = require("../time");
const log = require("../logger");

const API_BASE = "https://animeschedule.net/api/v3";
const SITE_BASE = "https://animeschedule.net/anime";
const IMG_BASE = "https://img.animeschedule.net/production/assets/public/img/";

// AnimeSchedule serves the "ongoing" list unauthenticated, 18 shows a page and
// ~175 shows in total. That's ten requests for the whole airing season, so we
// download it once and slice all three calendar days out of the same snapshot
// rather than paging it again per day.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PAGES = 20;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Ten pages back to back is enough to trip AnimeSchedule's rate limiter, so we
// pace them and back off rather than losing the whole snapshot to one 429.
const PAGE_DELAY_MS = 350;
const RETRIES = 3;
const RETRY_BASE_MS = 1500;

let cache = { at: 0, shows: null };
// The three calendar days are fetched in parallel and all want the same
// snapshot. Without this they each start their own paging run and rate-limit
// each other, so concurrent callers share one in-flight download.
let inFlight = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  let lastError;

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        // The open endpoints 403 unidentified clients; name ourselves honestly.
        "User-Agent": "discord-release-radar (+anime schedule fallback)",
      },
    });

    if (res.ok) return res.json();

    const text = await res.text();
    lastError = new Error(
      `AnimeSchedule HTTP ${res.status}: ${text.slice(0, 200)}`
    );

    // Only a rate limit is worth waiting out — a 4xx won't fix itself.
    if (res.status !== 429 || attempt === RETRIES) throw lastError;

    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : RETRY_BASE_MS * 2 ** attempt;
    log.warn("animeschedule rate limited, backing off", { waitMs, attempt: attempt + 1 });
    await sleep(waitMs);
  }

  throw lastError;
}

async function downloadOngoing() {
  const shows = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (page > 1) await sleep(PAGE_DELAY_MS);
    const data = await getJson(
      `${API_BASE}/anime?airing-statuses=ongoing&st=popularity&page=${page}`
    );
    const batch = data?.anime || [];
    if (!batch.length) break;
    shows.push(...batch);
    if (data.totalAmount && shows.length >= data.totalAmount) break;
  }
  return shows;
}

/** Every currently-airing show, cached for CACHE_TTL_MS. */
async function fetchOngoing() {
  if (cache.shows && Date.now() - cache.at < CACHE_TTL_MS) return cache.shows;
  if (inFlight) return inFlight;

  inFlight = downloadOngoing()
    .then((shows) => {
      cache = { at: Date.now(), shows };
      log.info("animeschedule ongoing", { count: shows.length });
      return shows;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** AnimeSchedule writes "no value" as year 1 rather than null. */
function realDate(value) {
  if (!value || value.startsWith("0001")) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** "233 233 233" → "#e9e9e9", so covers keep tinting the embed as before. */
function dominantColorHex(value) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) return null;
  return `#${parts.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Same intent as the AniList provider: a recognisable primary title plus a
 * distinct native/romaji spelling, never repeating the primary.
 *
 * `topLevel` is the record's own `title`, which carries the romaji spelling for
 * the many shows that list only a native name under `names` — without it those
 * rows land on the board as Japanese script alone.
 */
function pickTitles(names = {}, topLevel = null) {
  const english = names.english || null;
  const romaji = names.romaji || topLevel || null;
  const native = names.native || null;

  const primary = english || romaji || native || "Unknown anime";

  let secondary = null;
  if (native && native !== primary) secondary = native;
  else if (romaji && romaji !== primary) secondary = romaji;

  const romajiHint =
    romaji && romaji !== primary && romaji !== secondary ? romaji : null;

  return { primary, secondary, romajiHint };
}

/**
 * The instant this show airs inside [startMs, endMs], or null if it doesn't.
 *
 * `jpnTime` is one real broadcast instant, and a weekly show repeats on that
 * same weekday and time, so we step the anchor by whole weeks onto the target
 * day rather than trusting it to already point at the day we're asking about.
 */
function airingInDay(anchorMs, startMs, endMs) {
  const weeks = Math.round((startMs - anchorMs) / WEEK_MS);
  // Check the neighbouring weeks too: rounding can land one slot short when the
  // air time sits near midnight.
  for (const k of [weeks - 1, weeks, weeks + 1]) {
    const at = anchorMs + k * WEEK_MS;
    if (at >= startMs && at <= endMs) return at;
  }
  return null;
}

/**
 * Which episode airs at `airingAtMs`, counting weeks from the premiere.
 *
 * This is an estimate — the open endpoint doesn't carry a per-airing episode
 * number the way AniList's schedule does. Shows that took a mid-season break
 * drift past their own episode count, so anything that overshoots is reported
 * as no episode number at all rather than a confident wrong one.
 */
function estimateEpisode(show, airingAtMs) {
  const premier = realDate(show.premier);
  if (!premier) return null;

  const episode = Math.floor((airingAtMs - premier) / WEEK_MS) + 1;
  if (episode < 1) return null;
  if (show.episodes && episode > show.episodes) return null;
  return episode;
}

/** True while a show is on an announced break covering the target day. */
function onBreak(show, airingAtMs) {
  const from = realDate(show.delayedFrom);
  const until = realDate(show.delayedUntil);
  if (!from || !until) return false;
  return airingAtMs >= from && airingAtMs < until;
}

/**
 * Where a service sits in the user's own list (config/services.json), so the
 * one row of "where to watch" names the service they actually subscribe to.
 *
 * AnimeSchedule lists streams in its own order, which routinely puts Apple TV
 * ahead of the Crunchyroll simulcast — and the board only has room for the
 * first one.
 */
function serviceRank(site) {
  const name = String(site).toLowerCase();
  const index = config.services.findIndex((service) =>
    service.match.some((m) => name.includes(m.toLowerCase()))
  );
  return index === -1 ? config.services.length : index;
}

function watchLinksFor(show) {
  const streams = show.websites?.streams || show.streams || [];
  const seen = new Set();
  const links = [];

  for (const s of streams) {
    if (!s?.url) continue;
    const site = s.name || s.platform;
    if (!site) continue;
    const key = site.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // These come back bare ("www.crunchyroll.com/…") — Discord only linkifies
    // a full URL.
    const url = /^https?:\/\//i.test(s.url) ? s.url : `https://${s.url}`;
    links.push({ site, url });
  }

  return links.sort((a, b) => serviceRank(a.site) - serviceRank(b.site));
}

/** All ongoing shows airing on a given local calendar day. */
async function fetchAnimeForDay(dayKey, date = new Date()) {
  const { startMs, endMs, ymd } = dayBounds(config.timezone, date);
  const shows = await fetchOngoing();

  const results = [];

  for (const show of shows) {
    // jpnTime is the JP broadcast slot, matching what AniList gave us; subTime
    // is the simulcast and stands in when a show has no listed broadcast.
    const anchor = realDate(show.jpnTime) ?? realDate(show.subTime);
    if (!anchor) continue;

    const airingAtMs = airingInDay(anchor, startMs, endMs);
    if (airingAtMs === null) continue;
    if (onBreak(show, airingAtMs)) continue;

    const format = (show.mediaTypes?.[0]?.name || "").toUpperCase();
    if (["MUSIC", "MANGA", "NOVEL"].includes(format)) continue;

    const { primary, secondary, romajiHint } = pickTitles(
      show.names,
      show.title
    );
    const episode = estimateEpisode(show, airingAtMs);
    const total = show.episodes || null;
    const localTime = formatLocalTime(config.timezone, airingAtMs);
    const links = watchLinksFor(show);

    // The tilde is load-bearing: it tells the reader this number was counted
    // from the premiere, not published per-episode.
    const epText = episode
      ? `~Ep ${episode}${total ? `/${total}` : ""}`
      : total
        ? `${total} eps`
        : "Airing";

    results.push({
      id: `anime:as:${show.id}:${ymd}`,
      mediaId: `as:${show.id}`,
      episode,
      totalEpisodes: total,
      kind: "anime",
      day: dayKey,
      title: primary,
      nativeTitle: secondary,
      romajiTitle: romajiHint,
      subtitle: epText,
      epLabel: epText,
      url: show.route ? `${SITE_BASE}/${show.route}` : SITE_BASE,
      image: show.imageVersionRoute
        ? `${IMG_BASE}${show.imageVersionRoute}`
        : null,
      color: dominantColorHex(show.posterDominantColor) || "#7C4DFF",
      airingAt: airingAtMs,
      localTime,
      genres: (show.genres || [])
        .map((g) => (typeof g === "string" ? g : g?.name))
        .filter(Boolean),
      format,
      rating: show.stats?.averageScore
        ? (show.stats.averageScore / 10).toFixed(1)
        : null,
      providerHints: links.map((l) => l.site),
      watchLinks: links,
      timingLabel: `${localTime} MYT`,
      source: "animeschedule",
    });

    if (results.length >= config.maxAnime) break;
  }

  results.sort((a, b) => a.airingAt - b.airingAt);
  log.info(`animeschedule ${dayKey}`, { ymd, count: results.length });
  return results;
}

function fetchAnimeForDayKey(dayKey) {
  return fetchAnimeForDay(dayKey, dateForDay(dayKey));
}

module.exports = { fetchAnimeForDay, fetchAnimeForDayKey, fetchOngoing };
