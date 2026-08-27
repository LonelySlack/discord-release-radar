const config = require("../config");
const { dayBounds, formatLocalTime, addDays } = require("../time");
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
 * dayKey is a label ("today" | "tomorrow") carried into the digest sections.
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

      const { primary, secondary, romajiHint } = pickTitles(media.title);
      const airingAtMs = item.airingAt * 1000;
      const localTime = formatLocalTime(config.timezone, airingAtMs);

      const streamingLinks = (media.externalLinks || [])
        .filter((l) =>
          /crunchyroll|netflix|disney|prime|hbo|max|viu|iqiyi|bilibili|youtube/i.test(
            l.site || ""
          )
        )
        .map((l) => l.site);

      results.push({
        id: `anime:${item.id}:${ymd}`,
        kind: "anime",
        day: dayKey,
        title: primary,
        nativeTitle: secondary,
        romajiTitle: romajiHint,
        subtitle: `Episode ${item.episode}${media.episodes ? ` / ${media.episodes}` : ""}`,
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
        providerHints: streamingLinks,
        timingLabel: `${localTime} MYT`,
      });
    }

    if (!schedules.length) break;
  }

  log.info(`anilist ${dayKey}`, { ymd, count: results.length });
  return results;
}

/** Anime airing on the local calendar day = today. */
function fetchTodayAnime() {
  return fetchAnimeForDay("today", new Date());
}

/** Anime airing on the local calendar day = tomorrow. */
function fetchTomorrowAnime() {
  return fetchAnimeForDay("tomorrow", addDays(1));
}

module.exports = { fetchTodayAnime, fetchTomorrowAnime, fetchAnimeForDay };
