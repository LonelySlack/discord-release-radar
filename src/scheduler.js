const cron = require("node-cron");
const config = require("./config");
const { alreadyNotified, markNotified } = require("./db");
const { sendRelease } = require("./notifier");
const { fetchUpcomingAnime } = require("./providers/anilist");
const {
  fetchNewMovies,
  fetchAiringTv,
  fetchRecentlyAvailable,
} = require("./providers/tmdb");

let running = false;

async function collectReleases() {
  const types = new Set(config.contentTypes.map((t) => t.toLowerCase()));
  const all = [];

  if (types.has("anime")) {
    try {
      const anime = await fetchUpcomingAnime();
      all.push(...anime);
      console.log(`[poll] anime: ${anime.length} in notify window`);
    } catch (err) {
      console.error("[poll] AniList error:", err.message);
    }
  }

  if (types.has("movie")) {
    try {
      const movies = await fetchNewMovies();
      const recent = await fetchRecentlyAvailable();
      all.push(...movies, ...recent);
      console.log(
        `[poll] movies: ${movies.length} today, ${recent.length} recent`
      );
    } catch (err) {
      console.error("[poll] TMDB movies error:", err.message);
    }
  }

  if (types.has("tv")) {
    try {
      const tv = await fetchAiringTv();
      all.push(...tv);
      console.log(`[poll] tv: ${tv.length} airing today on your services`);
    } catch (err) {
      console.error("[poll] TMDB TV error:", err.message);
    }
  }

  return all;
}

async function pollOnce(client) {
  if (running) {
    console.log("[poll] skipped (previous still running)");
    return;
  }
  running = true;

  try {
    const channel = await client.channels.fetch(config.channelId);
    if (!channel || !channel.isTextBased()) {
      console.error("[poll] DISCORD_CHANNEL_ID is not a text channel");
      return;
    }

    const releases = await collectReleases();
    let sent = 0;

    for (const item of releases) {
      if (alreadyNotified(item.id)) continue;
      const claimed = markNotified(item.id, item.kind, item.title);
      if (!claimed) continue;

      try {
        await sendRelease(channel, item);
        sent += 1;
        // Avoid Discord rate limits
        await new Promise((r) => setTimeout(r, 800));
      } catch (err) {
        console.error(`[poll] failed to send ${item.id}:`, err.message);
      }
    }

    console.log(`[poll] done — candidates=${releases.length} sent=${sent}`);
  } catch (err) {
    console.error("[poll] fatal:", err);
  } finally {
    running = false;
  }
}

function startScheduler(client) {
  if (!cron.validate(config.pollCron)) {
    throw new Error(`Invalid POLL_CRON: ${config.pollCron}`);
  }

  console.log(
    `[scheduler] cron="${config.pollCron}" notifyBefore=${config.notifyMinutesBefore}m region=${config.primaryRegion}`
  );

  // First poll shortly after boot (gives Discord ready time)
  setTimeout(() => pollOnce(client), 5000);

  cron.schedule(config.pollCron, () => {
    pollOnce(client);
  });
}

module.exports = { startScheduler, pollOnce };
