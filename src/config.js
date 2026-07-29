const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function required(name) {
  const value = process.env[name];
  if (!value || value.includes("your_")) {
    throw new Error(`Missing or placeholder env: ${name}. Copy .env.example to .env and fill it in.`);
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

const config = {
  discordToken: required("DISCORD_TOKEN"),
  channelId: required("DISCORD_CHANNEL_ID"),
  tmdbApiKey: required("TMDB_API_KEY"),
  primaryRegion: (process.env.PRIMARY_REGION || "MY").toUpperCase(),
  fallbackRegions: list("FALLBACK_REGIONS", "SG,US,JP,GB,ID,TH,PH").map((r) =>
    r.toUpperCase()
  ),
  notifyMinutesBefore: Number(process.env.NOTIFY_MINUTES_BEFORE || 30),
  pollCron: process.env.POLL_CRON || "*/10 * * * *",
  contentTypes: list("CONTENT_TYPES", "anime,movie,tv"),
  services: servicesConfig.services,
  dataDir: path.join(__dirname, "..", "data"),
  dbPath: path.join(__dirname, "..", "data", "radar.db"),
};

module.exports = config;
