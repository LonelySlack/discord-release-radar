const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function required(name) {
  const value = process.env[name];
  if (!value || value.includes("your_")) {
    throw new Error(
      `Missing or placeholder env: ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return value;
}

function list(name, fallback = "") {
  return (process.env[name] || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const servicesPath = path.join(__dirname, "..", "config", "services.json");
const servicesConfig = JSON.parse(fs.readFileSync(servicesPath, "utf8"));

const dataDir = path.join(__dirname, "..", "data");
const defaultWeeklyLogDir = path.join(
  process.env.HOME || "/home/lonelyslack",
  "logs",
  "release-radar-weekly"
);

const config = {
  discordToken: required("DISCORD_TOKEN"),
  /** First configured channel — kept for anything expecting a single id. */
  channelId: required("DISCORD_CHANNEL_ID").split(",")[0].trim(),
  /** Every channel the digest posts to (comma-separated in DISCORD_CHANNEL_ID). */
  channelIds: list("DISCORD_CHANNEL_ID"),
  tmdbApiKey: required("TMDB_API_KEY"),
  // Optional: free key from https://rawg.io/apidocs. Not required — without it
  // the games section falls back to Steam's public API (no key needed).
  rawgApiKey: (process.env.RAWG_API_KEY || "").trim().replace(/^your_.*/, ""),
  primaryRegion: (process.env.PRIMARY_REGION || "MY").toUpperCase(),
  fallbackRegions: list("FALLBACK_REGIONS", "SG,US,JP,GB,ID,TH,PH").map((r) =>
    r.toUpperCase()
  ),

  /** IANA timezone for "today" and cron (Malaysia default). */
  timezone: process.env.TIMEZONE || "Asia/Kuala_Lumpur",

  /**
   * Local hours (0-23) to post digests. Default: 09:00 + 20:00 MY.
   * Override with DIGEST_HOURS=9,20 or a full DIGEST_CRON.
   */
  digestHours: list("DIGEST_HOURS", "9,20")
    .map((h) => Number(h))
    .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23),

  /**
   * Cron for digests. Default derived from DIGEST_HOURS (twice daily).
   * Example: 0 9,20 * * *  → 09:00 and 20:00 in TIMEZONE
   */
  digestCron:
    process.env.DIGEST_CRON ||
    `0 ${(list("DIGEST_HOURS", "9,20").length
      ? list("DIGEST_HOURS", "9,20")
      : ["9", "20"]
    ).join(",")} * * *`,

  /**
   * Optional Sunday weekly ops summary to Discord (empty = file logs only).
   * Default: Sunday 21:00 local.
   */
  weeklySummaryCron: process.env.WEEKLY_SUMMARY_CRON || "0 21 * * 0",
  postWeeklySummary:
    String(process.env.POST_WEEKLY_SUMMARY || "true").toLowerCase() !== "false",

  contentTypes: list(
    "CONTENT_TYPES",
    "anime,movie,tv,cinema,game,epic,gamepass,psplus"
  ),

  /**
   * Where game releases come from: "steam" (no key) or "rawg" (needs key).
   * Default: rawg if a key is set, otherwise steam.
   */
  gameSource: (
    process.env.GAME_SOURCE ||
    ((process.env.RAWG_API_KEY || "").trim().replace(/^your_.*/, "")
      ? "rawg"
      : "steam")
  ).toLowerCase(),

  /** How many days ahead to look for cinema / game releases. */
  cinemaWindowDays: Number(process.env.CINEMA_WINDOW_DAYS || 45),

  /**
   * How far back "new on your services" reaches. TMDB can't tell us the date a
   * film landed on Netflix — only when it released — so a recent release that
   * is streaming now is the closest honest proxy for a new arrival.
   */
  movieWindowDays: Number(process.env.MOVIE_WINDOW_DAYS || 90),
  /**
   * Drops the long tail of filler (obscure standup specials, regional shorts)
   * that a newest-first sort otherwise puts at the top. TMDB has no popularity
   * filter in discover, so this is applied to the results we get back.
   */
  movieMinPopularity: Number(process.env.MOVIE_MIN_POPULARITY || 10),
  gameWindowDays: Number(process.env.GAME_WINDOW_DAYS || 30),

  /**
   * How far back a PlayStation Plus announcement stays on the board. Sony posts
   * the line-up monthly, so a window under ~30 days can leave the section empty
   * for weeks at a time.
   */
  psPlusWindowDays: Number(process.env.PSPLUS_WINDOW_DAYS || 45),
  /**
   * Showcase Radar — Nintendo Directs, State of Plays, Apple events, the AI
   * keynotes. Posted as its OWN message, not as a section of the daily board:
   * a Direct three weeks out has nothing to do with what airs tonight, and
   * burying it under today's anime is how you miss it.
   */
  showcasesEnabled:
    String(process.env.SHOWCASES_ENABLED || "true").toLowerCase() !== "false",
  /** Defaults to the digest channels when unset. */
  showcaseChannelIds: list("SHOWCASE_CHANNEL_ID").length
    ? list("SHOWCASE_CHANNEL_ID")
    : list("DISCORD_CHANNEL_ID"),
  /** How far ahead the board looks. */
  showcaseWindowDays: Number(process.env.SHOWCASE_WINDOW_DAYS || 90),
  /**
   * Countdown alerts fire when an event crosses each of these day marks — a
   * week out to start planning, five days to clear the evening, then the day
   * before and the day itself. Each mark fires once per event.
   */
  showcaseLeadDays: list("SHOWCASE_LEAD_DAYS", "7,5,1,0")
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0)
    .sort((a, b) => a - b),
  /** Daily board post. Default 09:30 — just after the morning digest. */
  showcaseCron: process.env.SHOWCASE_CRON || "30 9 * * *",
  /**
   * How often to check whether an event crossed a lead mark. Hourly, so a
   * date announced this afternoon still gets its alert today.
   */
  showcaseAlertCron: process.env.SHOWCASE_ALERT_CRON || "5 * * * *",
  /**
   * Watch official blogs for newly announced showcases (no keys). This is what
   * catches a State of Play announced two days out, which no annual rhythm can
   * predict.
   */
  showcaseFeeds:
    String(process.env.SHOWCASE_FEEDS || "true").toLowerCase() !== "false",
  maxShowcases: Number(process.env.MAX_SHOWCASES || 18),

  services: servicesConfig.services,
  dataDir,
  dbPath: path.join(dataDir, "radar.db"),
  weeklyLogDir: process.env.WEEKLY_LOG_DIR || defaultWeeklyLogDir,

  // Caps so digests stay readable on a small droplet
  maxAnime: Number(process.env.MAX_ANIME || 25),
  maxMovies: Number(process.env.MAX_MOVIES || 12),
  maxTv: Number(process.env.MAX_TV || 15),
  maxCinema: Number(process.env.MAX_CINEMA || 10),
  maxGames: Number(process.env.MAX_GAMES || 12),
  maxFreeGames: Number(process.env.MAX_FREE_GAMES || 8),
  maxGamePass: Number(process.env.MAX_GAMEPASS || 10),
  maxPsPlus: Number(process.env.MAX_PSPLUS || 3),
};

module.exports = config;
