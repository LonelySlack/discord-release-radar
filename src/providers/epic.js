const config = require("../config");
const log = require("../logger");

const FREE_GAMES =
  "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions";

/**
 * Epic's weekly giveaways — what's free right now, and what takes over next.
 * No API key: this is the same static endpoint the store front page reads.
 *
 * The response is the whole promo carousel, and most of it is ordinary sale
 * stock. A giveaway is specifically a 100%-off promotion, and Epic encodes that
 * as `discountPercentage: 0` — the field is what you still PAY, not what comes
 * off. So 0 is free and 50 is half price. Filter on anything looser and the
 * section fills with discounts wearing a "free" label.
 */
async function fetchFreeGames() {
  const cc = config.primaryRegion || "US";
  const url =
    `${FREE_GAMES}?locale=en-US` +
    `&country=${encodeURIComponent(cc)}&allowCountries=${encodeURIComponent(cc)}`;

  let elements;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Epic HTTP ${res.status}`);
    const json = await res.json();
    elements = json?.data?.Catalog?.searchStore?.elements || [];
  } catch (err) {
    log.error("epic free games failed", err);
    return [];
  }

  const now = Date.now();
  const out = [];

  for (const el of elements) {
    const promos = el.promotions || {};
    const live = firstFreeOffer(el, promos.promotionalOffers, now, "live");
    const soon = firstFreeOffer(el, promos.upcomingPromotionalOffers, now, "soon");
    const offer = live || soon;
    if (!offer) continue;

    const when = live ? offer.endDate : offer.startDate;
    out.push({
      id: `epic:${el.id}:${when}`,
      kind: "epic",
      // A giveaway window spans days, so it isn't tied to one calendar tab.
      day: "any",
      title: el.title || "Untitled",
      subtitle: live ? "Free now" : "Free soon",
      url: storeUrl(el),
      image: keyImage(el),
      color: "#2F2D2E",
      releaseDate: when,
      free: live ? "now" : "soon",
      // shortWhere() renders this verbatim, so it carries the deadline — the
      // only fact that decides whether you go and claim it.
      providerHints: [
        live ? `free until ${dayMonth(offer.endDate)}` : `free from ${dayMonth(offer.startDate)}`,
      ],
      timingLabel: live ? "🎁 free now" : `🎁 free from ${dayMonth(offer.startDate)}`,
    });
  }

  // Claimable now first — those have a deadline; the rest are just a heads-up.
  out.sort((a, b) => {
    if (a.free !== b.free) return a.free === "now" ? -1 : 1;
    return new Date(a.releaseDate) - new Date(b.releaseDate);
  });

  log.info("epic free games", { cc, count: out.length, scanned: elements.length });
  return out.slice(0, config.maxFreeGames);
}

/**
 * The first genuinely-free offer in a promotion block, or null. Epic nests them
 * two deep (groups of offers), and a title can carry a stale window either side
 * of the live one, so the dates are checked rather than trusted.
 */
function firstFreeOffer(el, groups, now, phase) {
  for (const group of groups || []) {
    for (const offer of group?.promotionalOffers || []) {
      const pct = offer?.discountSetting?.discountPercentage;
      const price = el?.price?.totalPrice?.discountPrice;
      const isFree = pct === 0 || price === 0;
      if (!isFree) continue;

      const start = Date.parse(offer.startDate);
      const end = Date.parse(offer.endDate);
      if (phase === "live" && !(start <= now && now <= end)) continue;
      if (phase === "soon" && !(start > now)) continue;
      return offer;
    }
  }
  return null;
}

/**
 * Epic scatters the store path across several fields, and they are NOT
 * interchangeable:
 *   - a mapping's pageType can be "offer" rather than "productHome", and an
 *     offer slug 404s under /p/ (Lost Castle ships one of each)
 *   - urlSlug is sometimes a bare GUID (Alone With You, Astral Ascent), which
 *     looks like a slug and resolves to nothing
 * So a productHome mapping is required, and anything else falls back to the
 * giveaway landing page — a working page beats a broken deep link.
 *
 * The store is a single-page app that answers 200 for unknown slugs and 403 to
 * anything without a browser fingerprint, so these cannot be checked by HTTP.
 */
function storeUrl(el) {
  const mappings = [
    ...(el.catalogNs?.mappings || []),
    ...(el.offerMappings || []),
  ];
  const home = mappings.find((m) => m?.pageType === "productHome" && m.pageSlug);
  const slug = home?.pageSlug || el.productSlug;
  return slug
    ? `https://store.epicgames.com/en-US/p/${String(slug).replace(/\/home$/, "")}`
    : "https://store.epicgames.com/en-US/free-games";
}

function keyImage(el) {
  const wanted = ["OfferImageWide", "DieselStoreFrontWide", "Thumbnail"];
  for (const type of wanted) {
    const hit = (el.keyImages || []).find((k) => k.type === type);
    if (hit?.url) return hit.url;
  }
  return el.keyImages?.[0]?.url || null;
}

function dayMonth(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "soon";
  return d
    .toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: config.timezone,
    })
    .replace("Sept", "Sep"); // match shortDate() so the columns line up
}

module.exports = { fetchFreeGames };
