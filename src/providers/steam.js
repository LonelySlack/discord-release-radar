const config = require("../config");
const { localYmd } = require("../time");
const log = require("../logger");

const STORE = "https://store.steampowered.com/api";

/**
 * Game releases via Steam's public storefront API — NO API KEY required.
 * Uses the front-page "coming soon" + "new releases" lists, then enriches each
 * with /appdetails to get the real release date. PC/Steam only (no console
 * exclusives) — switch to the RAWG provider for cross-platform coverage.
 */
async function fetchGameReleases() {
  const cc = config.primaryRegion || "US";

  let featured;
  try {
    const res = await fetch(
      `${STORE}/featuredcategories/?cc=${encodeURIComponent(cc)}&l=english`
    );
    if (!res.ok) throw new Error(`Steam featuredcategories HTTP ${res.status}`);
    featured = await res.json();
  } catch (err) {
    log.error("steam featuredcategories failed", err);
    return [];
  }

  // Steam's raw "coming soon" list is mostly shovelware; the recognisable titles
  // live in top_sellers. Round-robin across the pools (top sellers first) so the
  // digest is a varied mix rather than 10 junk indies in a row.
  const pools = [
    featured?.top_sellers?.items || [],
    featured?.coming_soon?.items || [],
    featured?.new_releases?.items || [],
  ];

  const seen = new Set();
  const candidates = [];
  const maxDepth = Math.max(...pools.map((p) => p.length), 0);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    for (const pool of pools) {
      const it = pool[depth];
      if (!it?.id || seen.has(it.id)) continue;
      seen.add(it.id);
      candidates.push(it);
    }
  }

  const today = localYmd(config.timezone);
  const out = [];
  // Enrich until we have enough games, but bound the number of API calls.
  const maxLookups = config.maxGames * 3;
  let looked = 0;

  for (const item of candidates) {
    if (out.length >= config.maxGames || looked >= maxLookups) break;
    looked += 1;

    const details = await appDetails(item.id, cc);
    if (!details) continue;
    // Keep only actual games (drop DLC, soundtracks, demos, hardware).
    if (details.type && details.type !== "game") continue;
    if (isJunkTitle(details.name || item.name)) continue;

    const rd = details.release_date || {};
    const isComingSoon = Boolean(rd.coming_soon);
    const dateText = rd.date || null; // human string, e.g. "Aug 26, 2026"

    const platforms = [];
    if (item.windows_available ?? details.platforms?.windows) platforms.push("Windows");
    if (item.mac_available ?? details.platforms?.mac) platforms.push("macOS");
    if (item.linux_available ?? details.platforms?.linux) platforms.push("Linux");

    out.push({
      id: `game:steam:${item.id}:${dateText || today}`,
      kind: "game",
      title: details.name || item.name || "Untitled game",
      subtitle: dateText
        ? isComingSoon
          ? `Releases ${dateText}`
          : `Released ${dateText}`
        : "New on Steam",
      url: `https://store.steampowered.com/app/${item.id}/`,
      image: item.header_image || details.header_image || null,
      color: "#1B2838",
      rating: null,
      releaseDate: dateText,
      platforms,
      providerHints: ["Steam"],
      timingLabel: dateText
        ? isComingSoon
          ? `🎮 ${dateText}`
          : `🎮 out ${dateText}`
        : "🎮 new on Steam",
    });

    await sleep(150); // be polite to the storefront API
  }

  log.info("steam games", { cc, count: out.length, looked });
  return out;
}

/** Filter obvious non-game entries that slip through (DLC bundles, packs, OSTs). */
function isJunkTitle(name = "") {
  return /supporter pack|soundtrack|\bost\b|season pass|\bdlc\b|expansion pass|demo\b|artbook|bundle/i.test(
    name
  );
}

async function appDetails(appid, cc) {
  try {
    const res = await fetch(
      `${STORE}/appdetails?appids=${appid}&cc=${encodeURIComponent(cc)}&l=english`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const entry = json?.[appid];
    if (!entry?.success || !entry.data) return null;
    return entry.data;
  } catch (err) {
    log.warn?.("steam appdetails failed", { appid, error: err.message });
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { fetchGameReleases };
