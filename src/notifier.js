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

function shortWhere(item) {
  if (item.kind === "cinema") return "🎬 In cinemas";
  if (item.kind === "game") {
    if (item.providerHints?.length) return item.providerHints.slice(0, 3).join(", ");
    if (item.platforms?.length) return item.platforms.slice(0, 3).join(", ");
    return "check stores";
  }

  // Anime: AniList gives real per-show URLs, so link each service by name.
  // Two is enough to be useful without the line wrapping on mobile.
  if (item.watchLinks?.length) {
    return item.watchLinks
      .slice(0, 2)
      .map((l) => `[${l.site}](${l.url})`)
      .join(" · ");
  }

  if (item.availability) {
    const { onPrimary, primaryServices, otherRegions, primaryLink, linkByRegion } =
      item.availability;
    // TMDB only has a single per-region "where to watch" page — wrap the
    // service list in it rather than pretending we have per-service deep links.
    const linked = (text, url) => (url ? `[${text}](${url})` : text);

    if (onPrimary && primaryServices.length) {
      return `🇲🇾 ${linked(primaryServices.slice(0, 3).join(", "), primaryLink)}`;
    }
    if (otherRegions?.length) {
      const [region, services] = otherRegions[0];
      return `🌍 ${region}: ${linked(
        (services || []).slice(0, 2).join(", "),
        (linkByRegion || {})[region]
      )}`;
    }
    return "tracked service (check apps)";
  }
  if (item.providerHints?.length) {
    return item.providerHints.slice(0, 3).join(", ");
  }
  return "check apps";
}

/** "2026-09-23" or "26 Aug, 2026" -> "23 Sep". Falls back to the raw string. */
function shortDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: config.timezone,
  });
}

/**
 * One item, formatted per section. The section header already says what the
 * list is ("TV airing today"), so lines carry only what differs between rows —
 * no "Airing today · … — Episode airing today" repetition. Cinema and games
 * fit on a single line; anime and shows use a second, indented detail line.
 */
function lineFor(item) {
  const title = item.url ? `[${item.title}](${item.url})` : item.title;
  const stamp = (text) => (text ? `\`${text}\` ` : "");

  // Single-line kinds: the date is the only varying detail worth showing.
  if (item.kind === "game") {
    const store = item.providerHints?.[0] || item.platforms?.[0];
    return `${stamp(shortDate(item.releaseDate))}${title}${store ? ` · ${store}` : ""}`;
  }
  if (item.kind === "cinema") {
    return `${stamp(shortDate(item.releaseDate))}${title}`;
  }

  // Movies: the release date says how fresh the arrival is, then where it plays.
  if (item.kind === "movie") {
    return `${stamp(shortDate(item.releaseDate))}${title}\n└ ${shortWhere(item)}`;
  }

  // Anime: airtime leads, details (native title, episode, where to watch)
  // follow. With no known stream we simply say nothing rather than pad the
  // line with "check apps".
  if (item.kind === "anime") {
    const where = item.watchLinks?.length ? shortWhere(item) : null;
    const details = [item.nativeTitle, item.epLabel, where].filter(Boolean);
    return `${stamp(item.localTime)}${title}\n└ ${details.join(" · ")}`;
  }

  // TV: "airing today" is already in the section header.
  return `${title}\n└ ${shortWhere(item)}`;
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

function sectionFields(name, items, emoji, emptyNote = "_Nothing here right now._") {
  if (!items.length) {
    return [{ name: `${emoji} ${name}`, value: emptyNote, inline: false }];
  }
  const lines = items.map(lineFor);
  const chunks = chunkLines(lines);
  return chunks.map((text, i) => ({
    name: i === 0 ? `${emoji} ${name} (${items.length})` : `${emoji} ${name} (cont.)`,
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
  return {
    anime: releases.filter((r) => r.kind === "anime" && onDay(r)),
    tv: releases.filter((r) => r.kind === "tv" && onDay(r)),
    movies: releases.filter((r) => r.kind === "movie"),
    cinema: releases.filter((r) => r.kind === "cinema"),
    games: releases.filter((r) => r.kind === "game"),
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
