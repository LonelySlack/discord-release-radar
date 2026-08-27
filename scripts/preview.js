/**
 * Preview the digest in your terminal — no Discord connection, no posting.
 * Run: npm run preview
 *
 * Needs a .env with your keys. DISCORD_TOKEN / DISCORD_CHANNEL_ID just need to
 * be non-placeholder to pass validation (they aren't used here); TMDB_API_KEY is
 * used for movies/TV/cinema. Anime + Steam games work with no key.
 */
const config = require("../src/config");
const { collectToday } = require("../src/scheduler");
const { buildDailyDigestEmbeds } = require("../src/notifier");
const { localYmd } = require("../src/time");

function stripMarkdownLinks(text) {
  // [Title](url) -> Title (url)
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

(async () => {
  console.log(
    `\nRelease Radar preview — region ${config.primaryRegion}, games via ${config.gameSource}\n` +
      `Content: ${config.contentTypes.join(", ")}\nFetching…\n`
  );

  const { all, counts } = await collectToday();
  const ymd = localYmd(config.timezone);
  const embeds = buildDailyDigestEmbeds(all, ymd, "morning", "all");

  for (const embed of embeds) {
    const d = embed.data;
    if (d.title) console.log(`\n================ ${d.title} ================`);
    if (d.description) console.log(stripMarkdownLinks(d.description));
    for (const field of d.fields || []) {
      console.log(`\n${field.name}`);
      console.log(stripMarkdownLinks(field.value));
    }
  }

  console.log("\n----------------------------------------");
  console.log("Counts:", JSON.stringify(counts));
  console.log("(This was a preview only — nothing was posted to Discord.)\n");
  process.exit(0);
})().catch((err) => {
  console.error("\nPreview failed:", err.message || err);
  process.exit(1);
});
