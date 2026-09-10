/**
 * Newly announced showcases, from the places that announce them.
 *
 * The annual catalog knows there is always a September Nintendo Direct. It
 * cannot know that this one is on the 12th, because Nintendo says so two days
 * beforehand and nowhere machine-readable. These four feeds are where that
 * sentence first appears, and all four are open and keyless:
 *
 *   PlayStation Blog   State of Play / PlayStation Showcase
 *   Xbox Wire          Xbox Games Showcase / Developer_Direct
 *   Apple Newsroom     "Apple special event" press release
 *   Nintendo (YouTube) Directs, whose video title carries the date outright
 *
 * A match needs a real showcase phrase, not just a brand name — a feed full of
 * game reviews and sale posts would otherwise fill the board with noise. When a
 * date can be read out of the post it becomes a confirmed, alertable event;
 * when it can't, the post still surfaces as an announcement you can click, and
 * says so rather than inventing a day.
 */
const log = require("../logger");

const UA = "release-radar/1.0 (+discord digest)";
const TIMEOUT_MS = 8000;

const SOURCES = [
  {
    key: "playstation",
    url: "https://blog.playstation.com/feed/",
    brand: "PlayStation",
    category: "gaming",
    series: "state-of-play",
    link: "https://blog.playstation.com/",
    // "State of Play returns", "PlayStation Showcase airs Wednesday"
    match: /state of play|playstation showcase/i,
  },
  {
    key: "xbox",
    url: "https://news.xbox.com/en-us/feed/",
    brand: "Xbox",
    category: "gaming",
    series: "xbox-showcase",
    link: "https://news.xbox.com/",
    match: /xbox games showcase|developer[_ ]direct|xbox showcase|xbox partner preview/i,
  },
  {
    key: "apple",
    url: "https://www.apple.com/newsroom/rss-feed.rss",
    brand: "Apple",
    category: "tech",
    series: "apple-event",
    link: "https://www.apple.com/apple-events/",
    // Apple's own wording for "we are holding an event".
    match: /special event|apple event|keynote|wwdc/i,
  },
  {
    key: "nintendo",
    // A channel's public feed — no key, and a Direct's title states its date.
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCGIY_O-8vW4rfX98KlMkvRg",
    brand: "Nintendo",
    category: "gaming",
    series: "nintendo-direct",
    link: "https://www.nintendo.com/nintendo-direct/",
    match: /nintendo direct|indie world|partner showcase/i,
  },
];

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad(n) {
  return String(n).padStart(2, "0");
}

/**
 * A date out of announcement prose. Three shapes cover essentially everything
 * these four publishers write:
 *
 *   "9.12.2026"          Nintendo's video titles (US month-first)
 *   "September 12, 2026" Apple and Xbox press releases
 *   "12 September"       the same, written the other way round
 *
 * A bare "September 12" has no year, so it takes the next one that hasn't
 * already passed — an announcement in December for a January event is common
 * and would otherwise resolve eleven months into the past.
 */
function parseDate(text, now = new Date()) {
  const s = String(text || "");
  const thisYear = now.getUTCFullYear();

  const dotted = s.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (dotted) {
    const [, mo, day, yr] = dotted.map(Number);
    const year = yr < 100 ? 2000 + yr : yr;
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad(mo)}-${pad(day)}`;
    }
  }

  // Both orders, scanned across the whole string rather than stopping at the
  // first match: "Showcase airs 12 June" hits "airs 12" first, and a single
  // match would take that non-month and give up.
  const shapes = [
    { re: /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b/g, monthFirst: true },
    { re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})(?:,?\s*(\d{4}))?\b/g, monthFirst: false },
  ];

  for (const { re, monthFirst } of shapes) {
    for (const m of s.matchAll(re)) {
      const month = MONTHS[String(monthFirst ? m[1] : m[2]).toLowerCase()];
      const day = Number(monthFirst ? m[2] : m[1]);
      if (!month || !(day >= 1 && day <= 31)) continue;

      let year = Number(m[3]);
      if (!year) {
        year = thisYear;
        // More than a week in the past means they meant next year.
        if (Date.UTC(year, month - 1, day) < now.getTime() - 7 * 86400000) year += 1;
      }
      return `${year}-${pad(month)}-${pad(day)}`;
    }
  }

  return null;
}

/** Feeds are RSS or Atom; both are flat lists of the three fields we want. */
function parseFeed(xml) {
  const items = [];
  const blocks =
    xml.match(/<item[\s>][\s\S]*?<\/item>/g) ||
    xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) ||
    [];

  for (const block of blocks) {
    items.push({
      title: tag(block, "title"),
      link: tag(block, "link") || attr(block, "link", "href"),
      published: tag(block, "pubDate") || tag(block, "published") || tag(block, "updated"),
      summary: tag(block, "description") || tag(block, "media:description"),
    });
  }
  return items;
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  return decode(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim());
}

/** Atom puts the URL in an attribute rather than the element body. */
function attr(block, name, key) {
  const m = block.match(new RegExp(`<${name}[^>]*\\b${key}="([^"]+)"`, "i"));
  return m ? decode(m[1]) : "";
}

function decode(s) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchOne(source, now) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let xml;
  try {
    const res = await fetch(source.url, {
      headers: { "user-agent": UA },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (err) {
    // One dead feed shouldn't cost the board the other three.
    log.error(`showcase feed failed (${source.key})`, err);
    return { events: [], announcements: [] };
  } finally {
    clearTimeout(timer);
  }

  const events = [];
  const announcements = [];
  // Only recent posts: these feeds carry ~10-15 entries, and a six-month-old
  // "State of Play returns tomorrow" is not an upcoming showcase.
  const cutoff = now.getTime() - 30 * 86400000;

  for (const item of parseFeed(xml)) {
    if (!source.match.test(item.title)) continue;
    const at = Date.parse(item.published);
    if (Number.isFinite(at) && at < cutoff) continue;

    const date = parseDate(item.title, now) || parseDate(item.summary, now);
    const base = {
      brand: source.brand,
      category: source.category,
      series: source.series,
      name: cleanName(item.title, source),
      url: item.link || source.link,
      source: source.key,
      announcedAt: Number.isFinite(at) ? at : null,
    };

    if (date) {
      events.push({
        ...base,
        id: `feed:${source.key}:${date}`,
        date,
        confirmed: true,
        note: `Announced by ${source.brand}`,
      });
    } else {
      announcements.push({ ...base, id: `feed:${source.key}:${item.link}` });
    }
  }

  return { events, announcements };
}

/** Titles carry the publisher's own framing; the board already says the brand. */
function cleanName(title, source) {
  const t = String(title)
    .replace(/\s*[-–|]\s*(Nintendo Switch.*|Xbox Wire|PlayStation\.Blog).*$/i, "")
    .trim();
  return t.length > 90 ? `${t.slice(0, 89)}…` : t || `${source.brand} showcase`;
}

/**
 * Everything the feeds are currently announcing.
 * @returns {Promise<{events: object[], announcements: object[]}>}
 */
async function fetchAnnouncedShowcases(now = new Date()) {
  const results = await Promise.all(SOURCES.map((s) => fetchOne(s, now)));

  const events = [];
  const announcements = [];
  const seen = new Set();

  for (const r of results) {
    for (const e of r.events) {
      // One Direct gets a blog post AND a video; the series+date pair is the
      // same event either way.
      const key = `${e.series}:${e.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(e);
    }
    announcements.push(...r.announcements);
  }

  announcements.sort((a, b) => (b.announcedAt || 0) - (a.announcedAt || 0));
  log.info("showcase feeds", {
    events: events.length,
    announcements: announcements.length,
  });
  return { events, announcements: announcements.slice(0, 5) };
}

module.exports = { fetchAnnouncedShowcases, parseDate, SOURCES };
