const { EmbedBuilder } = require("discord.js");

function availabilityLines(item) {
  if (!item.availability) {
    // Anime: soft hints only
    if (item.providerHints?.length) {
      return `Services (from listing links): **${item.providerHints.join(", ")}**`;
    }
    return "Service region data varies for anime — check your apps (Crunchyroll / Netflix / etc.).";
  }

  const { primaryServices, otherRegions, onPrimary } = item.availability;
  const lines = [];

  if (onPrimary) {
    lines.push(`🇲🇾 **Malaysia (MY):** ${primaryServices.join(", ")}`);
  } else {
    lines.push(`🇲🇾 **Malaysia (MY):** not listed on your tracked services`);
  }

  for (const [region, services] of otherRegions) {
    lines.push(`🌍 **${region}:** ${services.join(", ")}`);
  }

  if (!onPrimary && otherRegions.length) {
    lines.push(
      "_Same brand, different catalog — available on those services elsewhere._"
    );
  }

  return lines.join("\n");
}

function buildEmbed(item) {
  const kindEmoji = {
    anime: "🎌",
    movie: "🎬",
    tv: "📺",
  }[item.kind] || "🆕";

  const embed = new EmbedBuilder()
    .setTitle(`${kindEmoji} ${item.title}`)
    .setColor(item.color || 0x5865f2)
    .setTimestamp(item.airingAt ? new Date(item.airingAt) : new Date());

  if (item.subtitle) embed.setDescription(item.subtitle);
  if (item.url) embed.setURL(item.url);
  if (item.image) embed.setThumbnail(item.image);

  const fields = [];

  if (item.timingLabel) {
    fields.push({ name: "When", value: item.timingLabel, inline: true });
  }
  if (item.rating) {
    fields.push({ name: "Rating", value: `⭐ ${item.rating}`, inline: true });
  }
  if (item.format) {
    fields.push({ name: "Format", value: item.format, inline: true });
  }
  if (item.genres?.length) {
    fields.push({
      name: "Genres",
      value: item.genres.slice(0, 6).join(", "),
      inline: false,
    });
  }

  fields.push({
    name: "Where to watch",
    value: availabilityLines(item).slice(0, 1024),
    inline: false,
  });

  if (item.overview) {
    const text =
      item.overview.length > 280
        ? `${item.overview.slice(0, 277)}...`
        : item.overview;
    fields.push({ name: "Overview", value: text, inline: false });
  }

  embed.addFields(fields);
  embed.setFooter({ text: "Release Radar · MY-first + multi-region fallback" });
  return embed;
}

async function sendRelease(channel, item) {
  const embed = buildEmbed(item);
  await channel.send({ embeds: [embed] });
}

module.exports = { sendRelease, buildEmbed };
