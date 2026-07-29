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
  channelId: required("DISCORD_CHANNEL_ID"),
  tmdbApiKey: required("TMDB_API_KEY"),
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

  contentTypes: list("CONTENT_TYPES", "anime,movie,tv"),
  services: servicesConfig.services,
  dataDir,
  dbPath: path.join(dataDir, "radar.db"),
  weeklyLogDir: process.env.WEEKLY_LOG_DIR || defaultWeeklyLogDir,

  // Caps so digests stay readable on a small droplet
  maxAnime: Number(process.env.MAX_ANIME || 25),
  maxMovies: Number(process.env.MAX_MOVIES || 12),
  maxTv: Number(process.env.MAX_TV || 15),
};

module.exports = config;
