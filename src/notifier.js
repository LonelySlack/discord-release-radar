const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const config = require("./config");
const { formatLocalDateLabel, slotLabel, addDays } = require("./time");

/** The categories users can filter by (also drives the button row). */
const FILTERS = [
  { key: "all", label: "All", emoji: "🗂️" },
  { key: "anime", label: "Anime", emoji: "🎌" },
  { key: "movie", label: "Movies", emoji: "🎬" },
  { key: "tv", label: "TV", emoji: "📺" },
  { key: "cinema", label: "Cinema", emoji: "🎟️" },
  { key: "game", label: "Games", emoji: "🎮" },
];

function shortWhere(item) {
  if (item.kind === "cinema") return "🎬 In cinemas";
  if (item.kind === "game") {
    if (item.providerHints?.length) return item.providerHints.slice(0, 3).join(", ");
    if (item.platforms?.length) return item.platforms.slice(0, 3).join(", ");
    return "check stores";
  }
  if (item.availability) {
    const { onPrimary, primaryServices, otherRegions } = item.availability;
    if (onPrimary && primaryServices.length) {
      return `🇲🇾 ${primaryServices.slice(0, 3).join(", ")}`;
    }
    if (otherRegions?.length) {
      const [region, services] = otherRegions[0];
      return `🌍 ${region}: ${(services || []).slice(0, 2).join(", ")}`;
    }
    return "tracked service (check apps)";
  }
  if (item.providerHints?.length) {
    return item.providerHints.slice(0, 3).join(", ");
  }
  return "check apps";
}

function lineFor(item) {
  const time =
    item.kind === "anime" && item.localTime
      ? `**${item.localTime}** · `
      : item.timingLabel
        ? `_${item.timingLabel}_ · `
        : "";
  const title = item.url ? `[${item.title}](${item.url})` : item.title;
  // Surface the Japanese/native name for anime so it's always recognisable.
  const native =
    item.kind === "anime" && item.nativeTitle ? ` 「${item.nativeTitle}」` : "";
  // Episode line only for anime/movie/tv; cinema & games carry their date in the timing label.
  const ep =
    (item.kind === "anime" || item.kind === "movie" || item.kind === "tv") &&
    item.subtitle
      ? ` — ${item.subtitle}`
      : "";
  const where = shortWhere(item);
  return `• ${time}${title}${native}${ep}\n  └ ${where}`;
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

function categorize(releases) {
  return {
    animeToday: releases.filter((r) => r.kind === "anime" && r.day !== "tomorrow"),
    animeTomorrow: releases.filter((r) => r.kind === "anime" && r.day === "tomorrow"),
    movies: releases.filter((r) => r.kind === "movie"),
    tv: releases.filter((r) => r.kind === "tv"),
    cinema: releases.filter((r) => r.kind === "cinema"),
    games: releases.filter((r) => r.kind === "game"),
  };
}

/** Build the section fields honouring the active filter ("all" = everything). */
function fieldsForFilter(cats, filter) {
  const show = (key) => filter === "all" || filter === key;
  const tomorrowLabel = formatLocalDateLabel(config.timezone, addDays(1));
  const fields = [];

  if (show("anime")) {
    fields.push(...sectionFields("Anime airing today", cats.animeToday, "🎌"));
    fields.push(
      ...sectionFields(
        `Anime airing tomorrow · ${tomorrowLabel}`,
        cats.animeTomorrow,
        "🌅"
      )
    );
  }
  if (show("movie")) fields.push(...sectionFields("Movies out now", cats.movies, "🎬"));
  if (show("tv")) fields.push(...sectionFields("TV airing today", cats.tv, "📺"));
  if (show("cinema"))
    fields.push(...sectionFields("Coming to cinemas", cats.cinema, "🎟️"));
  if (show("game")) fields.push(...sectionFields("Game releases", cats.games, "🎮"));

  return fields;
}

/**
 * Daily "what's on" board. `filter` is "all" for the posted digest, or a single
 * category key for the ephemeral filtered view triggered by a button.
 * @param {'morning'|'evening'} slot
 */
function buildDailyDigestEmbeds(releases, ymd, slot = "morning", filter = "all") {
  const cats = categorize(releases);
  const animeTotal = cats.animeToday.length + cats.animeTomorrow.length;

  const dateLabel = formatLocalDateLabel(config.timezone);
  const label = slotLabel(slot);
  const emoji = slot === "evening" ? "🌙" : "☀️";
  const nextHint =
    slot === "morning"
      ? "Evening update around 20:00 MY"
      : "Next board tomorrow morning ~09:00 MY";
  const color = slot === "evening" ? 0x5865f2 : 0xf1c40f;

  const filterMeta = FILTERS.find((f) => f.key === filter) || FILTERS[0];
  const titleSuffix = filter === "all" ? "" : ` · ${filterMeta.emoji} ${filterMeta.label} only`;

  const countsLine =
    filter === "all"
      ? `🎌 Anime **${animeTotal}** · 🎬 Movies **${cats.movies.length}** · 📺 TV **${cats.tv.length}** · 🎟️ Cinema **${cats.cinema.length}** · 🎮 Games **${cats.games.length}**`
      : `Showing **${filterMeta.label}** only — use the buttons to switch.`;

  const header = new EmbedBuilder()
    .setTitle(`${emoji} Release Radar · ${label}${titleSuffix}`)
    .setColor(color)
    .setDescription(
      [
        `**${dateLabel}** · what's out / airing (${config.primaryRegion}-first)`,
        countsLine,
        `_${nextHint}_`,
      ].join("\n")
    )
    .setTimestamp(new Date())
    .setFooter({
      text: `${label} · ${ymd} · MY-first + multi-region fallback`,
    });

  const fields = fieldsForFilter(cats, filter);

  // Discord max 25 fields per embed — split if needed
  const embeds = [header];
  let current = header;
  let fieldCount = 0;

  for (const field of fields) {
    if (fieldCount >= 20) {
      current = new EmbedBuilder()
        .setColor(color)
        .setTitle(`📅 Release Radar · continued`)
        .setFooter({ text: `Daily digest · ${ymd}` });
      embeds.push(current);
      fieldCount = 0;
    }
    current.addFields(field);
    fieldCount += 1;
  }

  return embeds;
}

/** The row(s) of filter buttons that ride under the posted digest. */
function buildFilterRows() {
  const rows = [];
  for (let i = 0; i < FILTERS.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const f of FILTERS.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`rr:filter:${f.key}`)
          .setLabel(f.label)
          .setEmoji(f.emoji)
          .setStyle(f.key === "all" ? ButtonStyle.Primary : ButtonStyle.Secondary)
      );
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Post the digest. Returns the first sent message so the caller can remember
 * its data for the filter buttons. Buttons ride on the first message only.
 */
async function sendDailyDigest(channel, releases, ymd, slot = "morning") {
  const embeds = buildDailyDigestEmbeds(releases, ymd, slot, "all");
  const rows = buildFilterRows();

  let firstMessage = null;
  // Discord allows up to 10 embeds per message
  for (let i = 0; i < embeds.length; i += 10) {
    const isFirst = i === 0;
    const msg = await channel.send({
      embeds: embeds.slice(i, i + 10),
      components: isFirst ? rows : [],
    });
    if (isFirst) firstMessage = msg;
  }
  return firstMessage;
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
  buildFilterRows,
  FILTERS,
};
