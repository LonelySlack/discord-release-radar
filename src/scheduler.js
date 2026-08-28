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
const { fetchAnimeForDayKey } = require("./providers/anilist");
const {
  fetchNewOnServices,
  fetchTvForDay,
  fetchUpcomingCinema,
} = require("./providers/tmdb");
const { fetchGameReleases } = require("./providers/games");
const { localYmd, digestSlot, DAY_KEYS } = require("./time");

let running = false;

/**
 * Everything the board can show: anime and TV for each of the three calendar
 * days (yesterday / today / tomorrow), plus the streaming, cinema and game
 * windows, which aren't tied to a single day and ride along on every tab.
 *
 * The TV days run one after another rather than all at once — each item costs a
 * TMDB watch-provider lookup, and three days in parallel is a burst TMDB would
 * rather we didn't send.
 */
async function collectBoard() {
  const types = new Set(config.contentTypes.map((t) => t.toLowerCase()));
  const counts = { anime: 0, movies: 0, tv: 0, cinema: 0, games: 0 };
  const all = [];

  if (types.has("anime")) {
    try {
      // AniList is a single cheap GraphQL call per day — fine in parallel.
      const days = await Promise.all(DAY_KEYS.map((key) => fetchAnimeForDayKey(key)));
      for (const items of days) {
        counts.anime += items.length;
        all.push(...items);
      }
    } catch (err) {
      log.error("AniList fetch failed", err);
    }
  }

  if (types.has("movie")) {
    try {
      const movies = await fetchNewOnServices();
      counts.movies = movies.length;
      all.push(...movies);
    } catch (err) {
      log.error("TMDB movies fetch failed", err);
    }
  }

  if (types.has("tv")) {
    for (const key of DAY_KEYS) {
      try {
        const tv = await fetchTvForDay(key);
        counts.tv += tv.length;
        all.push(...tv);
      } catch (err) {
        log.error(`TMDB TV fetch failed (${key})`, err);
      }
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

    const channels = await resolveChannels(client);
    if (!channels.length) {
      const errorMsg = "No usable channel in DISCORD_CHANNEL_ID";
      log.error(errorMsg);
      logPoll({ ymd, ...counts, sent: false, error: errorMsg });
      return;
    }

    const collected = await collectBoard();
    counts = collected.counts;
    const releases = collected.all;

    // Each channel gets its own message, and each is remembered separately so
    // the tabs and arrows work independently per channel.
    let delivered = 0;
    for (const channel of channels) {
      try {
        const message = await sendDailyDigest(channel, releases, ymd, slot);
        if (message?.id) remember(message.id, { releases, ymd, slot });
        delivered += 1;
      } catch (err) {
        // One bad channel shouldn't cost everyone else their digest.
        log.error(`digest send failed for #${channel.name}`, err);
      }
    }

    if (!delivered) throw new Error("digest failed for every channel");

    markDigestSent(
      ymd,
      slot,
      `${slot} digest ${ymd} (${releases.length} items, ${delivered} channel(s))`
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

/** Fetch every configured channel, skipping any that can't be used. */
async function resolveChannels(client) {
  const channels = [];
  for (const id of config.channelIds) {
    try {
      const channel = await client.channels.fetch(id);
      if (!channel?.isTextBased()) {
        log.error(`channel ${id} is not a text channel`);
        continue;
      }
      channels.push(channel);
    } catch (err) {
      log.error(`channel ${id} could not be fetched`, err);
    }
  }
  return channels;
}

async function runWeeklySummary(client) {
  try {
    const channels = await resolveChannels(client);
    if (!channels.length) return;

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

    for (const channel of channels) {
      try {
        await sendWeeklyOpsSummary(channel, body);
      } catch (err) {
        log.error(`weekly summary failed for #${channel.name}`, err);
      }
    }
    log.info("weekly ops summary posted", { channels: channels.length });
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
  collectBoard,
};
