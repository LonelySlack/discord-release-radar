const cron = require("node-cron");
const config = require("./config");
const log = require("./logger");
const {
  digestAlreadySent,
  markDigestSent,
  markNotified,
  clearNotified,
  logPoll,
  getRecentPolls,
} = require("./db");
const { sendDailyDigest, sendWeeklyOpsSummary } = require("./notifier");
const { sendShowcaseBoard, sendShowcaseAlert } = require("./showcaseNotifier");
const { remember } = require("./digestStore");
const { fetchAnimeForDayKey } = require("./providers/anime");
const {
  fetchNewOnServices,
  fetchTvForDay,
  fetchUpcomingCinema,
} = require("./providers/tmdb");
const { fetchGameReleases } = require("./providers/games");
const { fetchFreeGames } = require("./providers/epic");
const { fetchGamePassAdditions } = require("./providers/gamepass");
const { fetchPsPlus } = require("./providers/psplus");
const { collectShowcases, alertableShowcases } = require("./providers/showcases");
const { fetchAnnouncedShowcases } = require("./providers/showcaseFeeds");
const { recallDiscovered, rememberDiscovered } = require("./showcaseStore");
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
async function collectBoard(opts = {}) {
  const types = new Set(config.contentTypes.map((t) => t.toLowerCase()));
  const counts = {
    anime: 0,
    movies: 0,
    tv: 0,
    cinema: 0,
    games: 0,
    epic: 0,
    gamepass: 0,
    psplus: 0,
  };
  const all = [];

  if (types.has("anime")) {
    try {
      // One cheap call per day against whichever source is up — fine in parallel.
      const days = await Promise.all(DAY_KEYS.map((key) => fetchAnimeForDayKey(key)));
      for (const items of days) {
        counts.anime += items.length;
        all.push(...items);
      }
    } catch (err) {
      log.error("Anime fetch failed (all sources)", err);
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

  if (types.has("epic")) {
    try {
      const free = await fetchFreeGames();
      counts.epic = free.length;
      all.push(...free);
    } catch (err) {
      log.error("Epic free games fetch failed", err);
    }
  }

  if (types.has("gamepass")) {
    try {
      // Only a real digest advances the stored catalog snapshot — see the
      // provider. A preview run reads the same diff without spending it.
      const added = await fetchGamePassAdditions({ persist: Boolean(opts.persist) });
      counts.gamepass = added.length;
      all.push(...added);
    } catch (err) {
      log.error("Game Pass fetch failed", err);
    }
  }

  if (types.has("psplus")) {
    try {
      const plus = await fetchPsPlus();
      counts.psplus = plus.length;
      all.push(...plus);
    } catch (err) {
      log.error("PS Plus fetch failed", err);
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
  let counts = {
    anime: 0,
    movies: 0,
    tv: 0,
    cinema: 0,
    games: 0,
    epic: 0,
    gamepass: 0,
    psplus: 0,
  };

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

    // persist: this is the run that owns the Game Pass baseline.
    const collected = await collectBoard({ persist: true });
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
async function resolveChannels(client, ids = config.channelIds) {
  const channels = [];
  for (const id of ids) {
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

/* --------------------------------------------------------------- showcases */

/**
 * Everything the Showcase Radar knows right now: the curated calendar, plus
 * whatever the official feeds have announced since the last look. Feed failures
 * are non-fatal — a board built from the catalog alone is still a board.
 */
async function collectShowcaseBoard(now = new Date(), opts = {}) {
  const persist = opts.persist !== false;
  const useFeeds = opts.feeds !== false && config.showcaseFeeds;
  let announced = { events: [], announcements: [] };
  if (useFeeds) {
    try {
      announced = await fetchAnnouncedShowcases(now);
    } catch (err) {
      log.error("showcase feeds failed", err);
    }
  }

  // Discoveries are written down, not just used: the feeds are a day deep, and
  // an announcement that scrolls away must still stop the board predicting the
  // show it announced. A preview reads the same memory without adding to it.
  const known = persist
    ? rememberDiscovered(announced.events, now)
    : [...recallDiscovered(now), ...announced.events];

  const items = collectShowcases({ extra: known, now });
  return { items, announcements: announced.announcements, discovered: known };
}

/** The daily "what's coming" post — its own message, once a day. */
async function runShowcaseBoard(client, opts = {}) {
  if (!config.showcasesEnabled) return;

  const ymd = localYmd(config.timezone);
  try {
    // Same once-a-day guard the digest uses: an insert that changes nothing
    // means today's board already went out, so a restart can't repost it.
    if (!opts.force && !markNotified(`showcase-board:${ymd}`, "showcase", "board")) {
      log.info("showcase board already posted today", { ymd });
      return;
    }

    const channels = await resolveChannels(client, config.showcaseChannelIds);
    if (!channels.length) {
      log.error("No usable channel for the showcase board");
      clearNotified(`showcase-board:${ymd}`);
      return;
    }

    const { items, announcements } = await collectShowcaseBoard();
    let delivered = 0;
    for (const channel of channels) {
      try {
        await sendShowcaseBoard(channel, items, announcements);
        delivered += 1;
      } catch (err) {
        log.error(`showcase board failed for #${channel.name}`, err);
      }
    }
    // Nothing went out, so today's slot is still open — the next cron tick or
    // restart should try again rather than call it done.
    if (!delivered) {
      clearNotified(`showcase-board:${ymd}`);
      log.error("showcase board failed for every channel");
      return;
    }

    log.info("showcase board posted", {
      ymd,
      items: items.length,
      confirmed: items.filter((i) => i.confirmed).length,
      channels: delivered,
    });
  } catch (err) {
    log.error("showcase board fatal", err);
  }
}

/**
 * Countdown alerts.
 *
 * Each event is placed in the tightest lead mark it still fits — five days out
 * sits in the 7-day bucket until it reaches 5. Alerting on the bucket rather
 * than on an exact day means an event still gets its warning when the bot was
 * asleep on the day it crossed the mark, and never gets the same warning twice.
 */
async function runShowcaseAlerts(client, opts = {}) {
  if (!config.showcasesEnabled) return;
  const leads = config.showcaseLeadDays;
  if (!leads.length) return;

  try {
    const { items } = await collectShowcaseBoard();
    const due = [];

    for (const item of alertableShowcases(items)) {
      const lead = leads.find((d) => item.daysUntil <= d);
      if (lead === undefined) continue; // still beyond the first mark
      const key = `showcase:${item.seriesId}:${item.date}:lead${lead}`;
      // markNotified is the lock as well as the record: it only reports a
      // change the first time, so two overlapping runs can't double-post.
      if (!opts.force && !markNotified(key, "showcase", item.name)) continue;
      due.push({ item, lead, key });
    }

    if (!due.length) return;

    const channels = await resolveChannels(client, config.showcaseChannelIds);
    if (!channels.length) {
      log.error("No usable channel for showcase alerts");
      for (const { key } of due) clearNotified(key);
      return;
    }

    for (const { item, lead, key } of due) {
      let delivered = 0;
      for (const channel of channels) {
        try {
          await sendShowcaseAlert(channel, item, lead);
          delivered += 1;
        } catch (err) {
          log.error(`showcase alert failed for #${channel.name}`, err);
        }
      }
      // An alert nobody received hasn't happened — let the next hourly tick
      // have another go while the mark is still in the past.
      if (!delivered) {
        clearNotified(key);
        continue;
      }
      log.info("showcase alert sent", {
        name: item.name,
        date: item.date,
        lead,
        daysUntil: item.daysUntil,
      });
    }
  } catch (err) {
    log.error("showcase alerts fatal", err);
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
    showcases: config.showcasesEnabled,
    showcaseCron: config.showcaseCron,
    showcaseLeadDays: config.showcaseLeadDays,
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

  if (config.showcasesEnabled) {
    if (cron.validate(config.showcaseCron)) {
      cron.schedule(
        config.showcaseCron,
        () => {
          runShowcaseBoard(client).catch((err) => log.error("cron showcase board", err));
        },
        { timezone: config.timezone }
      );
    } else {
      log.error(`Invalid SHOWCASE_CRON: ${config.showcaseCron}`);
    }

    if (cron.validate(config.showcaseAlertCron)) {
      cron.schedule(
        config.showcaseAlertCron,
        () => {
          runShowcaseAlerts(client).catch((err) => log.error("cron showcase alerts", err));
        },
        { timezone: config.timezone }
      );
    } else {
      log.error(`Invalid SHOWCASE_ALERT_CRON: ${config.showcaseAlertCron}`);
    }

    // Catch up after a restart: today's board if it hasn't gone out, and any
    // lead mark that was crossed while the bot was down.
    setTimeout(() => {
      runShowcaseBoard(client)
        .then(() => runShowcaseAlerts(client))
        .catch((err) => log.error("boot showcase", err));
    }, 20000);
  }

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
  runShowcaseBoard,
  runShowcaseAlerts,
  collectBoard,
  collectShowcaseBoard,
};
