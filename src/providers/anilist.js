const config = require("../config");

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
 * Upcoming airing anime windows:
 * - from (now - 15m) so we don't miss just-aired
 * - to (now + notifyMinutesBefore + poll buffer)
 *
 * We notify when airing time is within NOTIFY_MINUTES_BEFORE of now,
 * or already aired (within last 15 minutes).
 */
async function fetchUpcomingAnime() {
  const nowSec = Math.floor(Date.now() / 1000);
  const beforeSec = config.notifyMinutesBefore * 60;
  const windowStart = nowSec - 15 * 60;
  const windowEnd = nowSec + beforeSec + 10 * 60; // +10m buffer for poll interval

  const query = `
    query ($page: Int, $from: Int, $to: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo { hasNextPage }
        airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
          id
          episode
          airingAt
          media {
            id
            idMal
            siteUrl
            format
            episodes
            genres
            coverImage { large color }
            title { romaji english native }
            externalLinks { site url }
          }
        }
      }
    }
  `;

  const data = await anilistQuery(query, {
    page: 1,
    from: windowStart,
    to: windowEnd,
  });

  const schedules = data?.Page?.airingSchedules || [];
  const results = [];

  for (const item of schedules) {
    const media = item.media;
    if (!media) continue;

    // Skip movies/OVA noise if you only want TV; keep TV + ONA mainly
    const format = (media.format || "").toUpperCase();
    if (["MUSIC", "MANGA", "NOVEL"].includes(format)) continue;

    const title =
      media.title?.english || media.title?.romaji || media.title?.native || "Unknown anime";
    const airingAtMs = item.airingAt * 1000;
    const minutesUntil = Math.round((airingAtMs - Date.now()) / 60000);

    // Only fire when inside the notify window (or just aired)
    if (minutesUntil > config.notifyMinutesBefore) continue;

    const streamingLinks = (media.externalLinks || [])
      .filter((l) =>
        /crunchyroll|netflix|disney|prime|hbo|max|viu|iqiyi|bilibili|youtube/i.test(
          l.site || ""
        )
      )
      .map((l) => l.site);

    results.push({
      id: `anime:${item.id}`,
      kind: "anime",
      title,
      subtitle: `Episode ${item.episode}${media.episodes ? ` / ${media.episodes}` : ""}`,
      url: media.siteUrl,
      image: media.coverImage?.large || null,
      color: media.coverImage?.color || "#7C4DFF",
      airingAt: airingAtMs,
      minutesUntil,
      genres: media.genres || [],
      format,
      // AniList external links as soft service hints; TMDB does hard region matching for movies/TV
      providerHints: streamingLinks,
      timingLabel:
        minutesUntil > 0
          ? `Airing in ~${minutesUntil} min`
          : minutesUntil === 0
            ? "Airing now"
            : `Aired ~${Math.abs(minutesUntil)} min ago`,
    });
  }

  return results;
}

module.exports = { fetchUpcomingAnime };
