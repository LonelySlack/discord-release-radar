const config = require("../config");
const { localYmd } = require("../time");
const log = require("../logger");

const BASE = "https://api.rawg.io/api";

/**
 * Game releases in a window around today (recent + upcoming) via RAWG.
 * RAWG needs a free API key (RAWG_API_KEY). If it's missing we quietly skip
 * games rather than crash the whole digest.
 */
async function fetchGameReleases() {
  if (!config.rawgApiKey) {
    log.info("rawg skipped", { reason: "no RAWG_API_KEY set" });
    return [];
  }

  const from = daysAgoLocal(2);
  const to = daysFromNowLocal(config.gameWindowDays);

  const url = new URL(`${BASE}/games`);
  url.searchParams.set("key", config.rawgApiKey);
  url.searchParams.set("dates", `${from},${to}`);
  url.searchParams.set("ordering", "-added"); // most-anticipated / popular first
  url.searchParams.set("page_size", String(config.maxGames));

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RAWG HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const items = data.results || [];
  const today = localYmd(config.timezone);
  const out = [];

  for (const game of items.slice(0, config.maxGames)) {
    const date = game.released || null;
    const platforms = (game.platforms || [])
      .map((p) => p.platform?.name)
      .filter(Boolean);
    const stores = (game.stores || [])
      .map((s) => s.store?.name)
      .filter(Boolean);

    const isOut = date && date <= today;

    out.push({
      id: `game:${game.id}:${date || to}`,
      kind: "game",
      title: game.name || "Untitled game",
      subtitle: date ? (isOut ? `Released ${date}` : `Releases ${date}`) : "New game",
      url: game.slug ? `https://rawg.io/games/${game.slug}` : null,
      image: game.background_image || null,
      color: "#9147FF",
      rating: game.rating ? Number(game.rating).toFixed(1) : null,
      releaseDate: date,
      platforms,
      // reuse the "where to get it" slot for stores (Steam, Epic, PS Store, …)
      providerHints: stores,
      timingLabel: date ? (isOut ? `🎮 out ${date}` : `🎮 ${date}`) : "Coming soon",
    });
  }

  log.info("rawg games", { from, to, count: out.length });
  return out;
}

function daysAgoLocal(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localYmd(config.timezone, d);
}

function daysFromNowLocal(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localYmd(config.timezone, d);
}

module.exports = { fetchGameReleases };
