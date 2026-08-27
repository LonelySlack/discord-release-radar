const config = require("../config");
const log = require("../logger");
const rawg = require("./rawg");
const steam = require("./steam");

/**
 * Picks the game-release source from config.gameSource:
 *   - "rawg"  → RAWG (needs RAWG_API_KEY, cross-platform)
 *   - "steam" → Steam public storefront API (no key, PC only)  [default]
 */
async function fetchGameReleases() {
  if (config.gameSource === "rawg") {
    if (config.rawgApiKey) return rawg.fetchGameReleases();
    // Asked for RAWG but no key present — fall back rather than skip games.
    log.warn("GAME_SOURCE=rawg but no RAWG_API_KEY; falling back to Steam");
  }
  return steam.fetchGameReleases();
}

module.exports = { fetchGameReleases };
