const config = require("../config");
const { dayBounds, formatLocalTime, dateForDay } = require("../time");
const log = require("../logger");

const ANILIST_URL = "https://graphql.anilist.co";

async function anilistQuery(query, variables = {}) {
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AniList HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`AniList GraphQL: ${json.errors[0].message}`);
  }
  return json.data;
}

/**
 * Pick a display (English/romaji) title plus a distinct Japanese/native title.
 * We want the user to always be able to recognise the show, so we surface both
 * when they differ (e.g. "Frieren" + "葬送のフリーレン").
 */
function pickTitles(mediaTitle = {}) {
  const english = mediaTitle.english || null;
  const romaji = mediaTitle.romaji || null;
  const native = mediaTitle.native || null;

  const primary = english || romaji || native || "Unknown anime";

  // The "other name" we show in parentheses: prefer the Japanese native script,
  // fall back to romaji, but never repeat what's already the primary.
  let secondary = null;
  if (native && native !== primary) secondary = native;
  else if (romaji && romaji !== primary) secondary = romaji;

  // If primary came from English, romaji is also useful as a searchable spelling.
  const romajiHint =
    romaji && romaji !== primary && romaji !== secondary ? romaji : null;

  return { primary, secondary, romajiHint };
}

/**
 * All anime episodes airing on a given local calendar day (default MY).
 * dayKey is a label ("yesterday" | "today" | "tomorrow") carried into the
 * digest so the calendar tabs can slice by it.
 */
async function fetchAnimeForDay(dayKey, date = new Date()) {
  const { startSec, endSec, ymd } = dayBounds(config.timezone, date);
  const query = `
    query ($page: Int, $from: Int, $to: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo { hasNextPage currentPage }
        airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
          id
          episode
          airingAt
          media {
            id
            siteUrl
            format
            episodes
            isAdult
            genres
            averageScore
            coverImage { large color }
            title { romaji english native }
            externalLinks { site url }
          }
        }
      }
    }
  `;

  const results = [];
  let page = 1;
  let hasNext = true;

  while (hasNext && results.length < config.maxAnime) {
    const data = await anilistQuery(query, {
      page,
      from: startSec,
      to: endSec,
    });

    const schedules = data?.Page?.airingSchedules || [];
    hasNext = Boolean(data?.Page?.pageInfo?.hasNextPage);
    page += 1;

    for (const item of schedules) {
      if (results.length >= config.maxAnime) break;
      const media = item.media;
      if (!media) continue;

      const format = (media.format || "").toUpperCase();
      if (["MUSIC", "MANGA", "NOVEL"].includes(format)) continue;
      // The digest posts to a shared channel — hentai has no business on it.
      if (media.isAdult) continue;

      const { primary, secondary, romajiHint } = pickTitles(media.title);
      const airingAtMs = item.airingAt * 1000;
      const localTime = formatLocalTime(config.timezone, airingAtMs);

      // AniList hands us real per-show watch URLs (Crunchyroll, Netflix, …).
      // Keep the url alongside the name so the digest can link straight to the
      // episode's page instead of only naming the service.
      const streamingLinks = (media.externalLinks || [])
        .filter(
          (l) =>
            l.url &&
            /crunchyroll|netflix|disney|prime|hbo|max|viu|iqiyi|bilibili|youtube/i.test(
              l.site || ""
            )
        )
        .map((l) => ({ site: l.site, url: l.url }));

      // AniList often lists a service twice (channel + playlist) — keep the
      // first URL per service so the digest never reads "YouTube · YouTube".
      const seenSites = new Set();
      const uniqueLinks = streamingLinks.filter((l) => {
        const key = l.site.toLowerCase();
        if (seenSites.has(key)) return false;
        seenSites.add(key);
        return true;
      });

      results.push({
        id: `anime:${item.id}:${ymd}`,
        mediaId: media.id,
        episode: item.episode,
        totalEpisodes: media.episodes || null,
        kind: "anime",
        day: dayKey,
        title: primary,
        nativeTitle: secondary,
        romajiTitle: romajiHint,
        subtitle: `Episode ${item.episode}${media.episodes ? ` / ${media.episodes}` : ""}`,
        epLabel: `Ep ${item.episode}${media.episodes ? `/${media.episodes}` : ""}`,
        url: media.siteUrl,
        image: media.coverImage?.large || null,
        color: media.coverImage?.color || "#7C4DFF",
        airingAt: airingAtMs,
        localTime,
        genres: media.genres || [],
        format,
        rating: media.averageScore
          ? (media.averageScore / 10).toFixed(1)
          : null,
        providerHints: uniqueLinks.map((l) => l.site),
        watchLinks: uniqueLinks,
        timingLabel: `${localTime} MYT`,
      });
    }

    if (!schedules.length) break;
  }

  log.info(`anilist ${dayKey}`, { ymd, count: results.length });
  return results;
}

/** Anime for one calendar tab: "yesterday" | "today" | "tomorrow". */
function fetchAnimeForDayKey(dayKey) {
  return fetchAnimeForDay(dayKey, dateForDay(dayKey));
}

module.exports = { fetchAnimeForDay, fetchAnimeForDayKey };
