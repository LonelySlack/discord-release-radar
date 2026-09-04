const config = require("../config");
const log = require("../logger");
const { getMetaValue, setMetaValue } = require("../db");

const SIGLS = "https://catalog.gamepass.com/sigls/v2";
const DISPLAY_CATALOG = "https://displaycatalog.mp.microsoft.com/v7.0/products";

/**
 * The two catalog lists. Microsoft publishes no "recently added" list we can
 * rely on — the ids that look like one are page ids, not catalog ids, and 404
 * here — so additions are worked out by diffing the full list against the last
 * run. That also makes removals available later from the same snapshot.
 */
const LISTS = [
  { key: "pc", label: "PC Game Pass", sigl: "fdd9e2a7-0fee-49f6-ad69-4354098401ff" },
  { key: "console", label: "Game Pass", sigl: "29a81209-df6f-41fd-a528-2ae6b91f719c" },
];

/** displaycatalog rejects very long id lists; this is comfortably under it. */
const BATCH = 20;

/**
 * Games that have just entered Game Pass.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.persist] store this run as the new baseline. Only the
 *   scheduled digest sets it — the preview script must be able to run a hundred
 *   times without consuming the diff the next real digest is going to report.
 */
async function fetchGamePassAdditions(opts = {}) {
  const { persist = false } = opts;
  const out = [];

  for (const list of LISTS) {
    try {
      const found = await fetchList(list);
      if (!found) continue;
      const { market, ids } = found;

      const metaKey = `gamepass:${list.key}:${market}`;
      const previous = readIds(metaKey);
      if (persist) setMetaValue(metaKey, JSON.stringify(ids));

      // First sight of a list is a baseline, not news — announcing it would
      // dump the entire 500-game catalog into the digest.
      if (!previous) {
        log.info("gamepass baseline stored", {
          list: list.key,
          market,
          count: ids.length,
          persisted: persist,
        });
        continue;
      }

      const known = new Set(previous);
      const added = ids.filter((id) => !known.has(id));
      log.info("gamepass diff", {
        list: list.key,
        market,
        total: ids.length,
        added: added.length,
      });
      if (added.length === 0) continue;

      const titles = await resolveTitles(added.slice(0, config.maxGamePass), market);
      for (const p of titles) {
        out.push({
          id: `gamepass:${list.key}:${p.id}`,
          kind: "gamepass",
          day: "any",
          title: p.title,
          subtitle: `New on ${list.label}`,
          url: `https://www.xbox.com/en-${market}/games/store/_/${p.id}`,
          image: p.image,
          color: "#107C10",
          releaseDate: null,
          providerHints: [
            market === config.primaryRegion
              ? `new on ${list.label}`
              : `new on ${list.label} · ${market}`,
          ],
          timingLabel: `🟩 new on ${list.label}`,
        });
      }
    } catch (err) {
      log.error(`gamepass ${list.key} failed`, err);
    }
  }

  return out;
}

/**
 * One catalog list, from the first market that actually serves it.
 *
 * Console Game Pass isn't sold in Malaysia or Singapore — the list returns 200
 * with zero games rather than an error — so an empty result walks the same
 * fallback regions the TV and cinema sections use. PC Game Pass does serve MY,
 * so it resolves on the first try and stays local.
 */
async function fetchList(list) {
  const markets = [config.primaryRegion, ...config.fallbackRegions];
  for (const market of markets) {
    const ids = await siglIds(list.sigl, market);
    if (ids.length > 0) return { market, ids };
    log.info("gamepass list empty in market", { list: list.key, market });
  }
  return null;
}

async function siglIds(sigl, market) {
  const url =
    `${SIGLS}?id=${encodeURIComponent(sigl)}` +
    `&language=en-us&market=${encodeURIComponent(market)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Game Pass sigl HTTP ${res.status}`);
  const json = await res.json();
  // Element 0 is the list's own metadata; the rest are product ids.
  return (Array.isArray(json) ? json : [])
    .filter((entry) => entry && entry.id)
    .map((entry) => entry.id);
}

/** Product ids carry no names, so the added ones get looked up in batches. */
async function resolveTitles(ids, market) {
  const out = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const url =
      `${DISPLAY_CATALOG}?bigIds=${batch.join(",")}` +
      `&market=${encodeURIComponent(market)}&languages=en-us`;
    try {
      const res = await fetch(url, { headers: { "MS-CV": "radar.1" } });
      if (!res.ok) throw new Error(`displaycatalog HTTP ${res.status}`);
      const json = await res.json();
      for (const product of json?.Products || []) {
        const local = product?.LocalizedProperties?.[0];
        if (!local?.ProductTitle) continue;
        out.push({
          id: product.ProductId,
          title: local.ProductTitle,
          image: bestImage(local),
        });
      }
    } catch (err) {
      log.warn("gamepass title lookup failed", { market, error: err.message });
    }
  }
  return out;
}

function bestImage(local) {
  const wanted = ["Poster", "BoxArt", "SuperHeroArt", "TitledHeroArt"];
  const images = local.Images || [];
  for (const purpose of wanted) {
    const hit = images.find((im) => im.ImagePurpose === purpose && im.Uri);
    if (hit) return hit.Uri.startsWith("//") ? `https:${hit.Uri}` : hit.Uri;
  }
  return null;
}

/** A malformed snapshot must not look like an empty catalog, or everything
 *  currently in Game Pass reads as newly added. */
function readIds(key) {
  const raw = getMetaValue(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    log.warn("gamepass snapshot unreadable, rebuilding baseline", { key });
    return null;
  }
}

module.exports = { fetchGamePassAdditions };
