/**
 * The Showcase Radar messages.
 *
 * These are their own posts, not sections of the daily digest. A Nintendo
 * Direct three weeks out and the anime airing at 23:30 tonight are different
 * kinds of information — one you diarise, one you watch — and folding the first
 * into the second is how a Direct gets scrolled past. So the board gets its own
 * heading, its own channel option and its own schedule, and a confirmed date
 * gets a second, louder message as it approaches.
 */
const { EmbedBuilder } = require("discord.js");
const config = require("./config");
const { formatLocalDateLabel } = require("./time");

/** Discord's own timestamp markup — every viewer reads it in their own zone. */
function discordTime(ms, style = "F") {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

/**
 * One event, one line. The date leads in backticks so the column stays aligned
 * down the list, and the countdown trails because "in 5 days" is what decides
 * whether you care today.
 */
function showcaseLine(item) {
  const name = item.url ? `[${item.name}](${item.url})` : `**${item.name}**`;
  const bits = [item.categoryEmoji];
  bits.push(item.live ? "**on now**" : item.countdown);
  if (!item.confirmed) bits.push("_expected_");
  return `\`${item.dateLabel}\` ${name} · ${bits.join(" · ")}`;
}

function chunkLines(lines, maxLen = 1000) {
  const chunks = [];
  let buf = [];
  let len = 0;
  for (const line of lines) {
    if (buf.length && len + line.length + 1 > maxLen) {
      chunks.push(buf.join("\n"));
      buf = [];
      len = 0;
    }
    buf.push(line);
    len += line.length + 1;
  }
  if (buf.length) chunks.push(buf.join("\n"));
  return chunks;
}

function groupFields(name, items, emoji) {
  if (!items.length) return [];
  const chunks = chunkLines(items.map(showcaseLine));
  const heading = `${emoji} ${name} (${items.length})`;
  return chunks.map((value, i) => ({
    name: chunks.length > 1 ? `${heading} · ${i + 1}/${chunks.length}` : heading,
    value: value.slice(0, 1024),
    inline: false,
  }));
}

/**
 * Buckets by how soon, because that's the only question the board answers.
 * "This week" is what you act on; the horizon is what you note.
 */
function bucket(items) {
  const groups = { now: [], week: [], month: [], horizon: [] };

  for (const item of items) {
    if (item.live) {
      groups.now.push(item);
      continue;
    }
    // "This week" is a claim about a day, so only an entry that knows its day
    // may make it. A month-level estimate anchored to the 15th is not evidence
    // that anything happens this week — it drops to the looser bucket.
    const knowsTheDay = item.datePrecision !== "month";
    if (item.daysUntil <= 7 && knowsTheDay) groups.week.push(item);
    else if (item.daysUntil <= 30) groups.month.push(item);
    else groups.horizon.push(item);
  }

  return groups;
}

/**
 * The daily board.
 * @param {object[]} items normalized showcases, soonest first
 * @param {object[]} [announcements] posts with no readable date
 */
function buildShowcaseBoard(items, announcements = []) {
  const capped = items.slice(0, config.maxShowcases);
  const groups = bucket(capped);
  const confirmed = capped.filter((i) => i.confirmed).length;

  const embed = new EmbedBuilder()
    .setTitle("📡 Showcase Radar · what's coming")
    .setColor(groups.week[0]?.color ?? groups.now[0]?.color ?? 0x5865f2)
    .setTimestamp(new Date())
    .setFooter({
      text: `${config.showcaseWindowDays}-day horizon · alerts at ${config.showcaseLeadDays
        .slice()
        .sort((a, b) => b - a)
        .map((d) => (d === 0 ? "the day" : `${d}d`))
        .join(" / ")} out`,
    });

  const lines = [
    `**${formatLocalDateLabel(config.timezone)}**`,
    `📅 **${capped.length}** on the radar · ✅ **${confirmed}** with a confirmed date`,
  ];
  if (groups.now.length) {
    lines.push(`🔴 **${groups.now.length}** happening right now`);
  }
  lines.push(
    "_A `~` date is the yearly pattern, not an announcement — countdown alerts only fire for confirmed dates._"
  );
  embed.setDescription(lines.join("\n"));

  const fields = [
    ...groupFields("On now", groups.now, "🔴"),
    ...groupFields("This week", groups.week, "🔥"),
    ...groupFields("Next 30 days", groups.month, "🗓️"),
    ...groupFields("On the horizon", groups.horizon, "🔭"),
  ];

  if (announcements.length) {
    fields.push({
      name: "📣 Just announced (no date given yet)",
      value: announcements
        .map((a) => `• [${a.name}](${a.url}) · ${a.brand}`)
        .join("\n")
        .slice(0, 1024),
      inline: false,
    });
  }

  if (!fields.length) {
    fields.push({
      name: "🔭 Nothing on the radar",
      value: `_No showcases in the next ${config.showcaseWindowDays} days._`,
      inline: false,
    });
  }

  embed.addFields(fields.slice(0, 25));
  return embed;
}

/**
 * The countdown alert — one event, deliberately loud. It fires once per lead
 * mark, so seeing it means something changed: the week mark, the five-day mark,
 * the eve, the day.
 */
function buildShowcaseAlert(item, lead) {
  const headline =
    item.daysUntil === 0
      ? "today"
      : item.daysUntil === 1
        ? "tomorrow"
        : `in ${item.daysUntil} days`;

  const embed = new EmbedBuilder()
    .setTitle(`${item.categoryEmoji} ${item.name}`)
    .setColor(item.color)
    .setTimestamp(new Date())
    .setFooter({
      text: `${item.categoryLabel} · ${lead === 0 ? "day-of" : `${lead}-day`} alert`,
    });

  const lines = [`**${item.dateLabel}** — starts ${headline}.`];
  // A clock time is the one thing worth a Discord timestamp: it lands in the
  // reader's own zone, which is the whole problem with a Japanese 07:00 stream.
  if (item.startsAt) {
    lines.push(`🕒 ${discordTime(item.startsAt)} (${discordTime(item.startsAt, "R")})`);
  }
  if (item.brand) lines.push(`📣 ${item.brand}`);
  if (item.note) lines.push(`_${item.note}_`);
  if (item.url) lines.push(`🔗 ${item.url}`);
  embed.setDescription(lines.join("\n"));

  return embed;
}

/** Heading + embed, so the post reads as its own thing in the channel. */
async function sendShowcaseBoard(channel, items, announcements = []) {
  return channel.send({
    content: "## 📡 Showcase Radar",
    embeds: [buildShowcaseBoard(items, announcements)],
  });
}

async function sendShowcaseAlert(channel, item, lead) {
  const when =
    item.daysUntil === 0
      ? "Today"
      : item.daysUntil === 1
        ? "Tomorrow"
        : `${item.daysUntil} days out`;
  return channel.send({
    content: `## ⏰ ${when} · ${item.name}`,
    embeds: [buildShowcaseAlert(item, lead)],
  });
}

module.exports = {
  buildShowcaseBoard,
  buildShowcaseAlert,
  sendShowcaseBoard,
  sendShowcaseAlert,
  showcaseLine,
};
