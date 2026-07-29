const { EmbedBuilder } = require("discord.js");
const config = require("./config");
const { formatLocalDateLabel, slotLabel } = require("./time");

function shortWhere(item) {
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
  const ep = item.subtitle ? ` — ${item.subtitle}` : "";
  const where = shortWhere(item);
  const title = item.url ? `[${item.title}](${item.url})` : item.title;
  return `• ${time}${title}${ep}\n  └ ${where}`;
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

function sectionFields(name, items, emoji) {
  if (!items.length) {
    return [
      {
        name: `${emoji} ${name}`,
        value: "_Nothing matched your services today._",
        inline: false,
      },
    ];
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
 * One (or a few) embeds: daily "what's on today" board.
 * @param {'morning'|'evening'} slot
 */
function buildDailyDigestEmbeds(releases, ymd, slot = "morning") {
  const anime = releases.filter((r) => r.kind === "anime");
  const movies = releases.filter((r) => r.kind === "movie");
  const tv = releases.filter((r) => r.kind === "tv");

  const dateLabel = formatLocalDateLabel(config.timezone);
  const total = releases.length;
  const label = slotLabel(slot);
  const emoji = slot === "evening" ? "🌙" : "☀️";
  const nextHint =
    slot === "morning"
      ? "Evening update around 20:00 MY"
      : "Next board tomorrow morning ~09:00 MY";
  const color = slot === "evening" ? 0x5865f2 : 0xf1c40f;

  const header = new EmbedBuilder()
    .setTitle(`${emoji} Release Radar · ${label}`)
    .setColor(color)
    .setDescription(
      [
        `**${dateLabel}** · what's out / airing today (${config.primaryRegion}-first)`,
        `🎌 Anime **${anime.length}** · 🎬 Movies **${movies.length}** · 📺 TV **${tv.length}** · **${total}** total`,
        `_${nextHint}_`,
      ].join("\n")
    )
    .setTimestamp(new Date())
    .setFooter({
      text: `${label} · ${ymd} · MY-first + multi-region fallback`,
    });

  const fields = [
    ...sectionFields("Anime airing today", anime, "🎌"),
    ...sectionFields("Movies", movies, "🎬"),
    ...sectionFields("TV airing today", tv, "📺"),
  ];

  // Discord max 25 fields per embed — split if needed
  const embeds = [header];
  let current = header;
  let fieldCount = 0;

  for (const field of fields) {
    if (fieldCount >= 20) {
      current = new EmbedBuilder()
        .setColor(0x5865f2)
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

async function sendDailyDigest(channel, releases, ymd, slot = "morning") {
  const embeds = buildDailyDigestEmbeds(releases, ymd, slot);
  // Discord allows up to 10 embeds per message
  for (let i = 0; i < embeds.length; i += 10) {
    await channel.send({ embeds: embeds.slice(i, i + 10) });
  }
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
};
