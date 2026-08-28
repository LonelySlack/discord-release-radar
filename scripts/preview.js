/**
 * Preview the digest in your terminal — no Discord connection, no posting.
 * Run: npm run preview
 *
 * Needs a .env with your keys. DISCORD_TOKEN / DISCORD_CHANNEL_ID just need to
 * be non-placeholder to pass validation (they aren't used here); TMDB_API_KEY is
 * used for movies/TV/cinema. Anime + Steam games work with no key.
 */
const config = require("../src/config");
const { collectBoard } = require("../src/scheduler");
const { buildDigestPage } = require("../src/notifier");
const { localYmd, DAY_KEYS } = require("../src/time");

function stripMarkdownLinks(text) {
  // [Title](url) -> Title (url)
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

(async () => {
  console.log(
    `\nRelease Radar preview — region ${config.primaryRegion}, games via ${config.gameSource}\n` +
      `Content: ${config.contentTypes.join(", ")}\nFetching…\n`
  );

  const { all, counts } = await collectBoard();
  const ymd = localYmd(config.timezone);

  // Walk every calendar tab, and inside each every page the ▶ button would
  // reach — so the preview shows the whole board, not just the tab and page
  // that get posted.
  for (const day of DAY_KEYS) {
    let page = 0;
    let pageCount = 1;
    do {
      const built = buildDigestPage(all, ymd, { slot: "morning", day, filter: "all", page });
      pageCount = built.pageCount;
      const d = built.embed.data;
      console.log(
        `\n================ ${d.title} — page ${page + 1}/${pageCount} ================`
      );
      if (d.description) console.log(stripMarkdownLinks(d.description));
      if (d.thumbnail?.url) console.log(`[thumbnail] ${d.thumbnail.url}`);
      for (const field of d.fields || []) {
        console.log(`\n${field.name}`);
        console.log(stripMarkdownLinks(field.value));
      }
      page += 1;
    } while (page < pageCount);
  }

  console.log("\n----------------------------------------");
  console.log("Counts:", JSON.stringify(counts));
  console.log("(This was a preview only — nothing was posted to Discord.)\n");
  process.exit(0);
})().catch((err) => {
  console.error("\nPreview failed:", err.message || err);
  process.exit(1);
});
