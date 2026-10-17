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
const { partitionSales, formatDay } = require("./providers/showcases");
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

/**
 * A sale line answers a different question. Nobody needs to know a sale started
 * eleven days ago; they need to know whether it ends tonight. So a live sale
 * leads with its deadline, and an upcoming one with how long the window is.
 */
function saleLine(item, opts = {}) {
  const name = item.url ? `[${item.name}](${item.url})` : `**${item.name}**`;
  const bits = [item.categoryEmoji];

  if (item.live) {
    const left = item.daysUntilEnd;
    bits.push(
      left <= 0
        ? "**ends today**"
        : left === 1
          ? "**ends tomorrow**"
          : `**${left} days left**`
    );
    if (left > 1) bits.push(`until ${formatDay(item.endDate)}`);
  } else {
    bits.push(item.countdown);
  }

  // Tagging every row "expected" in a list where nothing is confirmed is just
  // noise — the `~` already says it. The tag earns its place only when a real,
  // announced sale sits in the same list and needs telling apart.
  if (!item.confirmed && opts.showExpected !== false) bits.push("_expected_");
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

function groupFields(name, items, emoji, render = showcaseLine) {
  if (!items.length) return [];
  const chunks = chunkLines(items.map(render));
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
  // Two budgets, not one. November has a Black Friday sale on five storefronts
  // at once, and a shared cap would let them push every Direct off the board.
  const { events, sales } = partitionSales(items);
  const capped = events.slice(0, config.maxShowcases);
  const cappedSales = sales.slice(0, config.maxSales);
  const groups = bucket(capped);
  const liveSales = cappedSales.filter((i) => i.live);
  const soonSales = cappedSales.filter((i) => !i.live);
  const confirmed = [...capped, ...cappedSales].filter((i) => i.confirmed).length;

  const embed = new EmbedBuilder()
    .setTitle("📡 Showcase Radar · what's coming")
    .setColor(
      groups.week[0]?.color ?? groups.now[0]?.color ?? liveSales[0]?.color ?? 0x5865f2
    )
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
    `📅 **${capped.length}** on the radar · 🏷️ **${cappedSales.length}** store sales · ` +
      `✅ **${confirmed}** with a confirmed date`,
  ];
  if (groups.now.length) {
    lines.push(`🔴 **${groups.now.length}** happening right now`);
  }
  if (liveSales.length) {
    lines.push(`🏷️ **${liveSales.length}** sales live right now`);
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
    // Sales sit below the events on purpose: an event is a time you have to be
    // somewhere, a sale is a window you get to choose a moment inside.
    ...groupFields("On sale now", liveSales, "🏷️", saleLine),
    ...groupFields("Sales coming up", soonSales, "🏷️", saleLine),
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
 * `/sales` — the sale calendar on its own, a year deep.
 *
 * The daily board stops at 90 days, which is right for a Direct and wrong for a
 * sale: "should I buy this now or wait for the Summer Sale" is a question asked
 * in September about June. So this one looks a full year ahead, and buckets by
 * whether you can act today, soon, or only note it down.
 *
 * @param {object[]} sales normalized sale items, soonest first
 * @param {object} [opts]
 * @param {string} [opts.store] only this storefront
 * @param {number} [opts.windowDays] how far ahead this list actually looked
 */
function buildSalesBoard(sales, opts = {}) {
  const store = (opts.store || "").trim();
  const windowDays = opts.windowDays || config.saleWindowDays;
  const matching = store
    ? sales.filter(
        (i) =>
          String(i.brand || "").toLowerCase().includes(store.toLowerCase()) ||
          String(i.name || "").toLowerCase().includes(store.toLowerCase())
      )
    : sales;

  const live = matching.filter((i) => i.live);
  const soon = matching.filter((i) => !i.live && i.daysUntil <= 30);
  const later = matching.filter((i) => !i.live && i.daysUntil > 30);

  const embed = new EmbedBuilder()
    .setTitle(`🏷️ Game sale calendar${store ? ` · ${store}` : ""}`)
    .setColor(live.length ? 0xe67e22 : 0x5865f2)
    .setTimestamp(new Date())
    .setFooter({
      text: `${Math.round(windowDays / 30)}-month horizon · dates are the yearly pattern until a store confirms`,
    });

  const lines = [`**${formatLocalDateLabel(config.timezone)}**`];
  if (live.length) {
    lines.push(`🟢 **${live.length}** on right now · **${matching.length}** in the window`);
  } else {
    lines.push(`📅 **${matching.length}** sales in the next ${Math.round(windowDays / 30)} months`);
  }
  lines.push(
    "_A `~` window is where the sale has landed every year, not an announcement. " +
      "Stores confirm about a week out._"
  );
  embed.setDescription(lines.join("\n"));

  const anyConfirmed = matching.some((i) => i.confirmed);
  const render = (item) => saleLine(item, { showExpected: anyConfirmed });
  const fields = [
    ...groupFields("On sale now", live, "🟢", render),
    ...groupFields("Starting within 30 days", soon, "🔥", render),
    ...groupFields("Later in the year", later, "🗓️", render),
  ];

  if (!fields.length) {
    fields.push({
      name: "🔭 Nothing found",
      value: store
        ? `_No sales listed for **${store}**. Try /sales with no store._`
        : "_No sales in the catalog window._",
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
  buildSalesBoard,
  saleLine,
  buildShowcaseAlert,
  sendShowcaseBoard,
  sendShowcaseAlert,
  showcaseLine,
};
