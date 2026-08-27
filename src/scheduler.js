const cron = require("node-cron");
const config = require("./config");
const log = require("./logger");
const {
  digestAlreadySent,
  markDigestSent,
  logPoll,
  getRecentPolls,
} = require("./db");
const { sendDailyDigest, sendWeeklyOpsSummary } = require("./notifier");
const { remember } = require("./digestStore");
const { fetchTodayAnime, fetchTomorrowAnime } = require("./providers/anilist");
const {
  fetchNewMovies,
  fetchAiringTv,
  fetchRecentlyAvailable,
  fetchUpcomingCinema,
} = require("./providers/tmdb");
const { fetchGameReleases } = require("./providers/games");
const { localYmd, digestSlot } = require("./time");

let running = false;

async function collectToday() {
  const types = new Set(config.contentTypes.map((t) => t.toLowerCase()));
  const counts = { anime: 0, movies: 0, tv: 0, cinema: 0, games: 0 };
  const all = [];

  if (types.has("anime")) {
    try {
      // Today + tomorrow so you can see what's coming up next, not only today.
      const [today, tomorrow] = await Promise.all([
        fetchTodayAnime(),
        fetchTomorrowAnime(),
      ]);
      counts.anime = today.length + tomorrow.length;
      all.push(...today, ...tomorrow);
    } catch (err) {
      log.error("AniList fetch failed", err);
    }
  }

  if (types.has("movie")) {
    try {
      const movies = await fetchNewMovies();
      const recent = await fetchRecentlyAvailable();
      counts.movies = movies.length + recent.length;
      all.push(...movies, ...recent);
    } catch (err) {
      log.error("TMDB movies fetch failed", err);
    }
  }

  if (types.has("tv")) {
    try {
      const tv = await fetchAiringTv();
      counts.tv = tv.length;
      all.push(...tv);
    } catch (err) {
      log.error("TMDB TV fetch failed", err);
    }
  }

  if (types.has("cinema")) {
    try {
      const cinema = await fetchUpcomingCinema();
      counts.cinema = cinema.length;
      all.push(...cinema);
    } catch (err) {
      log.error("TMDB cinema fetch failed", err);
    }
  }

  if (types.has("game")) {
    try {
      const games = await fetchGameReleases();
      counts.games = games.length;
      all.push(...games);
    } catch (err) {
      log.error("RAWG games fetch failed", err);
    }
  }

  return { all, counts };
}

/**
 * Post a digest for the current (or forced) slot: morning | evening.
 * Twice daily by default (09:00 + 20:00 MY) — each slot once per day.
 */
async function runDailyDigest(client, opts = {}) {
  if (running) {
    log.warn("digest skipped (previous still running)");
    return;
  }
  running = true;

  const ymd = localYmd(config.timezone);
  const hours =
    config.digestHours?.length > 0 ? config.digestHours : [9, 20];
  const slot = opts.slot || digestSlot(config.timezone, hours);
  let counts = { anime: 0, movies: 0, tv: 0, cinema: 0, games: 0 };

  try {
    if (!opts.force && digestAlreadySent(ymd, slot)) {
      log.info("digest already sent for slot", { ymd, slot });
      logPoll({
        ymd,
        ...counts,
        sent: false,
        error: `already_sent:${slot}`,
      });
      log.pollResult({ ymd, slot, skipped: true, reason: "already_sent" });
      return;
    }

    const channel = await client.channels.fetch(config.channelId);
    if (!channel || !channel.isTextBased()) {
      const errorMsg = "DISCORD_CHANNEL_ID is not a text channel";
      log.error(errorMsg);
      logPoll({ ymd, ...counts, sent: false, error: errorMsg });
      return;
    }

    const collected = await collectToday();
    counts = collected.counts;
    const releases = collected.all;

    const message = await sendDailyDigest(channel, releases, ymd, slot);
    if (message?.id) {
      // Remember the data so the filter buttons on this message can re-render it.
      remember(message.id, { releases, ymd, slot });
    }
    markDigestSent(
      ymd,
      slot,
      `${slot} digest ${ymd} (${releases.length} items)`
    );

    log.pollResult({
      ymd,
      slot,
      sent: true,
      itemCount: releases.length,
      ...counts,
    });
    logPoll({ ymd, ...counts, sent: true, error: null });
  } catch (err) {
    const errorMsg = err.message || String(err);
    log.error("digest fatal", err);
    logPoll({ ymd, ...counts, sent: false, error: errorMsg });
  } finally {
    running = false;
  }
}

async function runWeeklySummary(client) {
  try {
    const channel = await client.channels.fetch(config.channelId);
    if (!channel || !channel.isTextBased()) return;

    const polls = getRecentPolls(14);
    const lines = polls.map((p) => {
      const flag = p.error ? `⚠️ ${p.error}` : p.sent ? "✅ sent" : "· skip";
      return `• **${p.ymd}** — anime ${p.anime} · movies ${p.movies} · tv ${p.tv} — ${flag}`;
    });

    const body = [
      log.formatWeekSummary(),
      "",
      "**Recent digests**",
      ...(lines.length ? lines : ["_No poll history yet._"]),
      "",
      `_Detailed logs: \`${config.weeklyLogDir}\`_`,
    ].join("\n");

    await sendWeeklyOpsSummary(channel, body);
    log.info("weekly ops summary posted");
  } catch (err) {
    log.error("weekly summary failed", err);
  }
}

function startScheduler(client) {
  if (!cron.validate(config.digestCron)) {
    throw new Error(`Invalid DIGEST_CRON: ${config.digestCron}`);
  }

  log.info("scheduler start", {
    digestCron: config.digestCron,
    digestHours: config.digestHours,
    timezone: config.timezone,
    weeklySummaryCron: config.weeklySummaryCron,
    postWeeklySummary: config.postWeeklySummary,
    region: config.primaryRegion,
    mode: "twice-daily digest",
  });

  // Catch up current slot after boot if not yet posted
  setTimeout(() => {
    runDailyDigest(client).catch((err) => log.error("boot digest", err));
  }, 8000);

  cron.schedule(
    config.digestCron,
    () => {
      runDailyDigest(client).catch((err) => log.error("cron digest", err));
    },
    { timezone: config.timezone }
  );

  if (config.postWeeklySummary && cron.validate(config.weeklySummaryCron)) {
    cron.schedule(
      config.weeklySummaryCron,
      () => {
        runWeeklySummary(client).catch((err) =>
          log.error("cron weekly", err)
        );
      },
      { timezone: config.timezone }
    );
  }
}

module.exports = {
  startScheduler,
  runDailyDigest,
  runWeeklySummary,
  collectToday,
};
