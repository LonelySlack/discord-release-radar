const config = require("../config");
const log = require("../logger");

const FEED = "https://blog.playstation.com/feed/";

/**
 * PlayStation Plus monthly games, from the PlayStation Blog feed.
 *
 * Sony publishes no catalog API for Plus, so unlike the other sources this one
 * reports the ANNOUNCEMENT rather than the games: the monthly line-up only
 * exists as prose inside a blog post. You get the post and its date; the titles
 * are one tap away. Scraping the post body for game names was the alternative,
 * and it breaks every time the blog changes its markup.
 *
 * The feed carries only the ~10 newest posts, which is fine — the bot polls
 * twice a day, so a monthly announcement cannot slip past unseen.
 */
async function fetchPsPlus() {
  let xml;
  try {
    const res = await fetch(FEED, {
      headers: { "user-agent": "release-radar/1.0 (+discord digest)" },
    });
    if (!res.ok) throw new Error(`PlayStation Blog HTTP ${res.status}`);
    xml = await res.text();
  } catch (err) {
    log.error("ps plus feed failed", err);
    return [];
  }

  const cutoff = Date.now() - config.psPlusWindowDays * 86400000;
  const out = [];

  for (const item of parseItems(xml)) {
    if (!isPsPlusPost(item.title)) continue;
    const at = Date.parse(item.pubDate);
    if (Number.isFinite(at) && at < cutoff) continue;

    out.push({
      id: `psplus:${item.link || item.title}`,
      kind: "psplus",
      day: "any",
      title: cleanTitle(item.title),
      subtitle: "PlayStation Plus",
      url: item.link,
      image: null,
      color: "#0070D1",
      releaseDate: Number.isFinite(at) ? new Date(at).toISOString() : null,
      providerHints: ["PlayStation Plus"],
      timingLabel: "🔵 PlayStation Plus",
    });
  }

  out.sort((a, b) => new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0));
  log.info("ps plus", { count: out.length });
  return out.slice(0, config.maxPsPlus);
}

/**
 * Sony writes the same announcement several ways ("PlayStation Plus Monthly
 * Games", "PS Plus Game Catalog"), so the match is on the brand plus a games
 * word rather than one exact headline. Hardware and sale posts also say "Plus",
 * which is what the second half filters out.
 */
function isPsPlusPost(title = "") {
  if (!/playstation\s*plus|\bps\s*plus\b/i.test(title)) return false;
  return /games|catalog|line-?up|classics|monthly/i.test(title);
}

/** Regional posts are prefixed "(For Southeast Asia)" — true, but not news. */
function cleanTitle(title = "") {
  return title.replace(/^\(For [^)]+\)\s*/i, "").trim();
}

/**
 * Minimal RSS reader. The feed is a fixed, well-formed shape and this saves a
 * parser dependency on a box that runs five bots; fields arrive either bare or
 * wrapped in CDATA, so both are unwrapped.
 */
function parseItems(xml) {
  const items = [];
  for (const block of xml.match(/<item[\s>][\s\S]*?<\/item>/g) || []) {
    items.push({
      title: tag(block, "title"),
      link: tag(block, "link"),
      pubDate: tag(block, "pubDate"),
    });
  }
  return items;
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  return decode(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim());
}

function decode(s) {
  return s
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

module.exports = { fetchPsPlus };
