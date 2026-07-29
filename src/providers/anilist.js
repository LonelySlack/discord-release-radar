const config = require("../config");
const { dayBounds, formatLocalTime } = require("../time");
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
 * All anime episodes airing on the local calendar day (default MY).
 * Sorted by air time — used for the daily digest (not 30‑min pings).
 */
async function fetchTodayAnime() {
  const { startSec, endSec, ymd } = dayBounds(config.timezone);
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

      const title =
        media.title?.english ||
        media.title?.romaji ||
        media.title?.native ||
        "Unknown anime";
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
        title,
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

  log.info("anilist today", { ymd, count: results.length });
  return results;
}

module.exports = { fetchTodayAnime };
