const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const config = require("./config");
const {
  formatLocalDateLabel,
  slotLabel,
  DAY_TABS,
  dayTab,
  dayWord,
  dateForDay,
  formatDayTabLabel,
} = require("./time");

/** The categories users can filter by (also drives the button row). */
const FILTERS = [
  { key: "all", label: "All", emoji: "🗂️" },
  { key: "anime", label: "Anime", emoji: "🎌" },
  { key: "movie", label: "Movies", emoji: "🎬" },
  { key: "tv", label: "TV", emoji: "📺" },
  { key: "cinema", label: "Cinema", emoji: "🎟️" },
  { key: "game", label: "Games", emoji: "🎮" },
];

/**
 * Discord counts title + description + footer + author + every field name and
 * value, and caps the SUM across all embeds in one message at 6000. We keep a
 * safety margin under both so a long board degrades into more messages rather
 * than a rejected send.
 */
const MESSAGE_EMBED_BUDGET = 5600;
const PER_EMBED_BUDGET = 4800;
/** Field characters allowed on one page, leaving room for title/description. */
const PAGE_FIELD_BUDGET = 3600;

/** "#7C4DFF" -> 0x7c4dff, for embed colours. Null when absent/malformed. */
function parseHexColor(hex) {
  if (typeof hex !== "string") return null;
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? parseInt(m[1], 16) : null;
}

/** Character count Discord attributes to one embed. */
function embedSize(embed) {
  const d = embed.data || {};
  let n = 0;
  n += (d.title || "").length;
  n += (d.description || "").length;
  n += (d.footer?.text || "").length;
  n += (d.author?.name || "").length;
  for (const f of d.fields || []) {
    n += (f.name || "").length + (f.value || "").length;
  }
  return n;
}

/**
 * Group embeds into per-message batches that respect both Discord limits:
 * at most 10 embeds and 6000 total characters per message.
 */
function batchEmbedsBySize(embeds, budget = MESSAGE_EMBED_BUDGET) {
  const batches = [];
  let batch = [];
  let size = 0;

  for (const embed of embeds) {
    const len = embedSize(embed);
    if (batch.length && (batch.length >= 10 || size + len > budget)) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(embed);
    size += len;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** Longest a title may run before it wraps on a phone. */
const TITLE_MAX = 52;

/** Trim at a word boundary where possible, so rows stay one line on mobile. */
function trimTitle(text) {
  const title = String(text || "").trim();
  if (title.length <= TITLE_MAX) return title;
  const cut = title.slice(0, TITLE_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > TITLE_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Where you can watch it, as ONE short label.
 *
 * Rows carry exactly one link (the title), because a Discord field caps at 1024
 * characters and counts the invisible URL text against it — a second link costs
 * ~70 characters and buys nothing the title link doesn't already reach. So the
 * service is named in plain text and the title is what you click.
 *
 * Returns null when we genuinely don't know, so the row can just say nothing
 * rather than pad itself with "check apps".
 */
function shortWhere(item) {
  if (item.kind === "cinema") return null; // the section header already says it

  if (item.kind === "game") {
    return item.providerHints?.[0] || item.platforms?.[0] || null;
  }

  // Anime: AniList names the real services. One is enough on a single line.
  if (item.watchLinks?.length) return item.watchLinks[0].site;
  if (item.providerHints?.length) return item.providerHints[0];

  if (item.availability) {
    const { onPrimary, primaryServices, otherRegions } = item.availability;
    if (onPrimary && primaryServices.length) {
      return `${primaryServices.slice(0, 2).join(", ")}`;
    }
    if (otherRegions?.length) {
      const [region, services] = otherRegions[0];
      return `${region} · ${(services || []).slice(0, 2).join(", ")}`;
    }
  }
  return null;
}

/** The flag that tells you at a glance whether it's watchable from here. */
function whereFlag(item) {
  if (item.kind !== "movie" && item.kind !== "tv") return "";
  if (!item.availability) return "";
  return item.availability.onPrimary ? "🇲🇾 " : "🌍 ";
}

/**
 * The one link a row gets. Movies and TV point at the region's "where to watch"
 * page (what you actually want when you tap the title); everything else points
 * at its own page.
 */
function shortenTmdb(url) {
  // ".../movie/1516698-the-last-sunrise/watch" -> ".../movie/1516698/watch".
  // TMDB 301s the slugless form to the full one, and the slug costs ~25
  // characters of the 1024 a field gets — which is what forces a section to
  // split into a second field.
  return url.replace(
    /(themoviedb\.org\/(?:movie|tv)\/\d+)-[^/?#]*/,
    "$1"
  );
}

function linkFor(item) {
  const a = item.availability;
  if (a) {
    if (a.onPrimary && a.primaryLink) return a.primaryLink;
    if (a.otherRegions?.length) {
      const link = (a.linkByRegion || {})[a.otherRegions[0][0]];
      if (link) return link;
    }
  }
  return item.url || null;
}

/** The row's link, trimmed of anything that doesn't change where it goes. */
function bestLink(item) {
  const url = linkFor(item);
  return url ? shortenTmdb(url) : null;
}

/** "2026-09-23" or "26 Aug, 2026" -> "23 Sep". Falls back to the raw string. */
function shortDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d
    .toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: config.timezone,
    })
    .replace("Sept", "Sep"); // en-GB's four-letter outlier breaks the column
}

/** Sort key for a row's date; undated rows sink to the bottom. */
function dateValue(item) {
  const t = new Date(item.releaseDate).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * One item = one line. The section header already says what the list is ("TV
 * airing today"), and the day tab says when, so a row carries only what differs
 * between rows: when, what, and where. Everything else — native titles, the
 * repeated "Airing today", a second watch link — was noise that pushed the
 * useful half of the row off a phone screen.
 *
 * @param {object} item
 * @param {object} [ctx]
 * @param {boolean} [ctx.hideWhere] drop the service when every row shares it
 */
function lineFor(item, ctx = {}) {
  const url = bestLink(item);
  const name = trimTitle(item.title);
  const title = url ? `[${name}](${url})` : `**${name}**`;

  // Leading fixed-width stamp: airtime for things that air, date for things
  // that drop. Backticks keep the column aligned down the list.
  // Day-bound kinds take their date from the calendar tab, so a per-row stamp
  // would just repeat it identically down the whole list.
  const lead =
    item.kind === "anime"
      ? item.localTime
      : item.kind === "tv"
        ? null
        : shortDate(item.releaseDate);
  const stamp = lead ? `\`${lead}\` ` : "";

  const bits = [];
  if (item.kind === "anime" && item.epLabel) bits.push(item.epLabel);
  if (!ctx.hideWhere) {
    const where = shortWhere(item);
    if (where) bits.push(`${whereFlag(item)}${where}`);
  }

  return `${stamp}${title}${bits.length ? ` · ${bits.join(" · ")}` : ""}`;
}

/**
 * Fold the several schedule rows a batch drop produces ("Ep 1/7", "Ep 2/7" at
 * the same time on the same day) into one row reading "Ep 1-2/7". AniList lists
 * every episode separately, which made a single show eat three lines of the
 * board.
 */
function mergeAnimeEpisodes(items) {
  const byShow = new Map();
  const order = [];

  for (const item of items) {
    const key = item.mediaId ? `${item.mediaId}:${item.day}` : item.id;
    if (!byShow.has(key)) {
      byShow.set(key, { ...item, episodes: [] });
      order.push(key);
    }
    const entry = byShow.get(key);
    if (Number.isFinite(item.episode)) entry.episodes.push(item.episode);
    // Keep the earliest airtime — that's when the show turns up for you.
    if (item.airingAt && item.airingAt < entry.airingAt) {
      entry.airingAt = item.airingAt;
      entry.localTime = item.localTime;
    }
  }

  return order.map((key) => {
    const entry = byShow.get(key);
    const eps = [...new Set(entry.episodes)].sort((a, b) => a - b);
    if (eps.length > 1) {
      const total = entry.totalEpisodes ? `/${entry.totalEpisodes}` : "";
      entry.epLabel = `Ep ${eps[0]}-${eps[eps.length - 1]}${total}`;
    }
    delete entry.episodes;
    return entry;
  });
}

function chunkLines(lines, maxLen = 1000) {
  const chunks = [];
  let buf = [];
  let len = 0;
  for (const line of lines) {
    const add = line.length + 1;
    if (buf.length && len + add > maxLen) {
      chunks.push(buf.join("\n"));
      buf = [];
      len = 0;
    }
    buf.push(line);
    len += add;
  }
  if (buf.length) chunks.push(buf.join("\n"));
  return chunks;
}

/**
 * A section of the board. When every row in it names the same service ("Steam"
 * on all twelve games) that word stops distinguishing anything, so it's dropped
 * from the rows and moved into the header instead.
 */
function sectionFields(name, items, emoji, emptyNote = "_Nothing here right now._") {
  if (!items.length) {
    return [{ name: `${emoji} ${name}`, value: emptyNote, inline: false }];
  }

  const wheres = items.map(shortWhere);
  const shared =
    wheres.every((w) => w && w === wheres[0]) && items.length > 1 ? wheres[0] : null;

  const lines = items.map((item) => lineFor(item, { hideWhere: Boolean(shared) }));
  const chunks = chunkLines(lines);
  const heading = `${emoji} ${name} (${items.length})${shared ? ` · ${shared}` : ""}`;

  // A section only ever splits when its links overflow Discord's 1024-character
  // field cap. Number the parts rather than repeating "(cont.)" — with one-line
  // rows this is now rare, and when it happens you can see how much is left.
  return chunks.map((text, i) => ({
    name: chunks.length > 1 ? `${heading} · ${i + 1}/${chunks.length}` : heading,
    value: text.slice(0, 1024),
    inline: false,
  }));
}

/**
 * Slice the board for one calendar tab. Anime and TV air on a given day, so
 * they follow the tabs. Movies, cinema and games are rolling windows — a film
 * doesn't "land on Netflix tomorrow" in any way TMDB can tell us — so they ride
 * along on every tab rather than emptying out on yesterday and tomorrow.
 */
function categorize(releases, day = "today") {
  const onDay = (r) => r.day === day;
  const byKind = (kind) => releases.filter((r) => r.kind === kind);

  const anime = mergeAnimeEpisodes(
    byKind("anime")
      .filter(onDay)
      .sort((a, b) => (a.airingAt || 0) - (b.airingAt || 0))
  );

  return {
    anime,
    tv: byKind("tv").filter(onDay),
    // Newest arrival first — "what landed since I last looked" is the question
    // this section answers.
    movies: byKind("movie").sort((a, b) => dateValue(b) - dateValue(a)),
    // Soonest first: these are dates you might plan around, and the list
    // arrived from TMDB in no order at all.
    cinema: byKind("cinema").sort((a, b) => dateValue(a) - dateValue(b)),
    games: byKind("game").sort((a, b) => dateValue(a) - dateValue(b)),
  };
}

/** Day-bound section headings, in the tense the selected day calls for. */
const SECTION_NAMES = {
  anime: {
    yesterday: "Anime that aired yesterday",
    today: "Anime airing today",
    tomorrow: "Anime airing tomorrow",
  },
  tv: {
    yesterday: "TV that aired yesterday",
    today: "TV airing today",
    tomorrow: "TV airing tomorrow",
  },
};

function sectionName(kind, day) {
  return SECTION_NAMES[kind][dayWord(day)];
}

/** Empty-state note for a day-bound section. */
function emptyFor(day) {
  if (day === "yesterday") return "_Nothing on your services yesterday._";
  if (day === "tomorrow") return "_Nothing scheduled for tomorrow yet._";
  return "_Nothing here right now._";
}

/**
 * Build the section fields honouring the active filter ("all" = everything).
 * Day-bound sections lead, then the rolling windows — so the parts that change
 * when you tap a calendar button are the ones you read first.
 */
function fieldsForFilter(cats, filter, day = "today") {
  const show = (key) => filter === "all" || filter === key;
  const empty = emptyFor(day);
  const fields = [];

  if (show("anime"))
    fields.push(...sectionFields(sectionName("anime", day), cats.anime, "🎌", empty));
  if (show("tv"))
    fields.push(...sectionFields(sectionName("tv", day), cats.tv, "📺", empty));
  if (show("movie"))
    fields.push(
      ...sectionFields(
        "New on your services",
        cats.movies,
        "🎬",
        "_Nothing new to stream on your services._"
      )
    );
  if (show("cinema"))
    fields.push(
      ...sectionFields(
        "Coming to cinemas",
        cats.cinema,
        "🎟️",
        "_No cinema dates on the radar._"
      )
    );
  if (show("game"))
    fields.push(
      ...sectionFields(
        "Game releases",
        cats.games,
        "🎮",
        "_No game releases on the radar._"
      )
    );

  return fields;
}

/** Flat item list for a filter, in the same order the sections render. */
function itemsForFilter(cats, filter) {
  const show = (key) => filter === "all" || filter === key;
  const out = [];
  if (show("anime")) out.push(...cats.anime);
  if (show("tv")) out.push(...cats.tv);
  if (show("movie")) out.push(...cats.movies);
  if (show("cinema")) out.push(...cats.cinema);
  if (show("game")) out.push(...cats.games);
  return out;
}

/**
 * Group section fields into pages that each fit inside ONE embed. Keeping a
 * page to a single embed means a digest is always one message — long lists
 * become extra pages behind the ▶ button instead of extra messages.
 */
function paginateFields(fields, budget = PAGE_FIELD_BUDGET) {
  const pages = [];
  let page = [];
  let size = 0;

  for (const field of fields) {
    const len = field.name.length + field.value.length;
    if (page.length && (page.length >= 20 || size + len > budget)) {
      pages.push(page);
      page = [];
      size = 0;
    }
    page.push(field);
    size += len;
  }
  if (page.length) pages.push(page);
  return pages.length ? pages : [[]];
}

/**
 * One page of the "what's on" board — always a single embed, so a digest is
 * always a single message.
 * @param {object[]} releases every item collected across all three days
 * @param {string} ymd the local date the digest was built on
 * @param {object} [view]
 * @param {'morning'|'evening'} [view.slot]
 * @param {'yesterday'|'today'|'tomorrow'} [view.day] which calendar tab to render
 * @param {string} [view.filter] category key, or "all"
 * @param {number} [view.page] zero-based page index within that day + filter
 */
function buildDigestPage(releases, ymd, view = {}) {
  const { slot = "morning", filter = "all", page = 0 } = view;
  const day = dayTab(view.day).key;

  const cats = categorize(releases, day);

  const dateLabel = formatLocalDateLabel(config.timezone, dateForDay(day));
  const dayName = dayTab(day).name;
  const nextHint =
    slot === "morning"
      ? "Evening update around 20:00 MY"
      : "Next board tomorrow morning ~09:00 MY";

  const filterMeta = FILTERS.find((f) => f.key === filter) || FILTERS[0];
  const titleSuffix =
    filter === "all" ? "" : ` · ${filterMeta.emoji} ${filterMeta.label}`;

  const pages = paginateFields(fieldsForFilter(cats, filter, day));
  const pageCount = pages.length;
  const index = Math.min(Math.max(page, 0), pageCount - 1);

  // A picture for the board: rotate through the posters of whatever is being
  // shown, so paging also changes the artwork.
  const art = itemsForFilter(cats, filter).filter((i) => i.image);
  const thumb = art.length ? art[index % art.length] : null;

  // Prefer the artwork's own accent colour (AniList gives one per show).
  const slotColor = slot === "evening" ? 0x5865f2 : 0xf1c40f;
  const color = parseHexColor(thumb?.color) ?? slotColor;

  // Two lines, because they answer different questions: what airs on the day
  // you picked, and what is sitting there waiting whichever day you picked.
  // One combined line would read as if the whole board changed with the tab.
  const airingLine = `🎌 **${cats.anime.length}** anime · 📺 **${cats.tv.length}** TV airing`;
  const rollingLine =
    `🎬 **${cats.movies.length}** new to stream · 🎟️ **${cats.cinema.length}** cinema` +
    ` · 🎮 **${cats.games.length}** games`;

  const embed = new EmbedBuilder()
    .setTitle(`${dayTab(day).emoji} Release Radar · ${dayName}${titleSuffix}`)
    .setColor(color)
    .setDescription(
      [
        `**${dateLabel}** · ${config.primaryRegion}-first`,
        airingLine,
        rollingLine,
        `_${nextHint}_`,
      ].join("\n")
    )
    .setTimestamp(new Date())
    .setFooter({
      text:
        pageCount > 1
          ? `${slotLabel(slot)} · ${ymd} · page ${index + 1}/${pageCount}`
          : `${slotLabel(slot)} · ${ymd} · MY-first + multi-region fallback`,
    });

  if (thumb?.image) embed.setThumbnail(thumb.image);
  if (pages[index].length) embed.addFields(pages[index]);

  return { embed, pageCount, page: index, day };
}

/** Back-compat wrapper: one day of the board as an array of embeds. */
function buildDailyDigestEmbeds(releases, ymd, slot = "morning", filter = "all") {
  const { embed } = buildDigestPage(releases, ymd, { slot, filter, day: "today" });
  return [embed];
}

/**
 * The calendar strip that sits above everything: yesterday · today · tomorrow,
 * each labelled with its actual date. Switching day keeps the active category
 * and resets to page 1, since the page count differs per day.
 * customId: rr:day:<day>:<filter>:0
 */
function buildCalendarRow(day = "today", filter = "all") {
  const row = new ActionRowBuilder();
  for (const tab of DAY_TABS) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`rr:day:${tab.key}:${filter}:0`)
        .setLabel(formatDayTabLabel(config.timezone, tab.key))
        .setEmoji(tab.emoji)
        // Green for the day you're on — the category tabs use blurple, so the
        // two rows stay tellable apart at a glance.
        .setStyle(tab.key === day ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
  }
  return row;
}

/**
 * Category tabs + page arrows. The active tab is highlighted and the arrows
 * disable at the ends, so the board reads like a paged menu.
 * customId carries the state: rr:view:<day>:<filter>:<page>
 */
function buildFilterRows(day = "today", filter = "all", page = 0, pageCount = 1) {
  const rows = [];
  for (let i = 0; i < FILTERS.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const f of FILTERS.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`rr:view:${day}:${f.key}:0`)
          .setLabel(f.label)
          .setEmoji(f.emoji)
          .setStyle(
            f.key === filter ? ButtonStyle.Primary : ButtonStyle.Secondary
          )
      );
    }
    rows.push(row);
  }

  // Page arrows live on the last row (it has room: 6 filters = 5 + 1).
  const navRow = rows[rows.length - 1];
  // Arrows get their own prefixes: custom ids must be unique across the whole
  // message, and at page 0 a "view"-prefixed ◀ would collide with the All tab.
  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`rr:prev:${day}:${filter}:${Math.max(page - 1, 0)}`)
      .setEmoji("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId("rr:noop")
      .setLabel(`${page + 1}/${pageCount}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`rr:next:${day}:${filter}:${Math.min(page + 1, pageCount - 1)}`)
      .setEmoji("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount - 1)
  );

  return rows;
}

/** Calendar on top, category filters and paging underneath. */
function buildBoardRows(day = "today", filter = "all", page = 0, pageCount = 1) {
  return [
    buildCalendarRow(day, filter),
    ...buildFilterRows(day, filter, page, pageCount),
  ];
}

/**
 * Post the digest as a single message, opened on today. Long boards become
 * extra pages behind the arrows rather than extra messages.
 */
async function sendDailyDigest(channel, releases, ymd, slot = "morning") {
  const { embed, pageCount, page, day } = buildDigestPage(releases, ymd, {
    slot,
    day: "today",
    filter: "all",
    page: 0,
  });

  return channel.send({
    embeds: [embed],
    components: buildBoardRows(day, "all", page, pageCount),
  });
}

async function sendWeeklyOpsSummary(channel, text) {
  const embed = new EmbedBuilder()
    .setTitle("📊 Release Radar · weekly ops")
    .setColor(0x99aab5)
    .setDescription(text.slice(0, 4000))
    .setTimestamp(new Date())
    .setFooter({ text: "File logs: ~/logs/release-radar-weekly/" });
  await channel.send({ embeds: [embed] });
}

module.exports = {
  sendDailyDigest,
  sendWeeklyOpsSummary,
  buildDailyDigestEmbeds,
  buildDigestPage,
  buildBoardRows,
  buildCalendarRow,
  buildFilterRows,
  batchEmbedsBySize,
  FILTERS,
};
