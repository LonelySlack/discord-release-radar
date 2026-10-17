/**
 * Preview the Showcase Radar in your terminal — no Discord, nothing posted.
 * Run: npm run preview:showcases
 *
 * Prints the board exactly as it would be posted, then the alert each upcoming
 * confirmed event would get, so you can see a countdown before it fires for
 * real. Add `--no-feeds` to render the catalog alone.
 */
const config = require("../src/config");
const { alertableShowcases } = require("../src/providers/showcases");
const { collectShowcaseBoard } = require("../src/scheduler");
const { buildShowcaseBoard, buildShowcaseAlert } = require("../src/showcaseNotifier");

function stripMarkdownLinks(text) {
  return String(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

function printEmbed(embed) {
  const d = embed.data;
  console.log(`\n================ ${d.title} ================`);
  if (d.description) console.log(stripMarkdownLinks(d.description));
  for (const field of d.fields || []) {
    console.log(`\n${field.name}`);
    console.log(stripMarkdownLinks(field.value));
  }
  if (d.footer?.text) console.log(`\n— ${d.footer.text}`);
}

(async () => {
  const useFeeds = !process.argv.includes("--no-feeds") && config.showcaseFeeds;
  console.log(
    `\nShowcase Radar preview — ${config.showcaseWindowDays}-day horizon, ` +
      `alerts at ${config.showcaseLeadDays.join("/")} days out, ` +
      `feeds ${useFeeds ? "on" : "off"}\n`
  );

  // persist:false — a preview reads the remembered discoveries but never adds
  // to them, the same way the digest preview leaves the Game Pass baseline be.
  const { items, announcements, discovered } = await collectShowcaseBoard(new Date(), {
    persist: false,
    feeds: useFeeds,
  });
  printEmbed(buildShowcaseBoard(items, announcements));

  const maxLead = Math.max(...config.showcaseLeadDays, 0);
  const upcoming = alertableShowcases(items).filter((i) => i.daysUntil <= 30);
  const armed = upcoming.filter((i) => i.daysUntil <= maxLead);
  const pending = upcoming.filter((i) => i.daysUntil > maxLead);

  if (armed.length) {
    console.log("\n\n--- countdown alerts due now ---");
    for (const item of armed) {
      printEmbed(
        buildShowcaseAlert(item, config.showcaseLeadDays.find((d) => item.daysUntil <= d))
      );
    }
  }
  if (pending.length) {
    console.log("\n\n--- alerts still waiting on their first mark ---");
    for (const item of pending) {
      console.log(
        `  ${item.name} — ${item.dateLabel}, ${item.daysUntil} days out; ` +
          `first alert in ${item.daysUntil - maxLead} days (the ${maxLead}-day mark)`
      );
    }
  }

  console.log(
    `\n----------------------------------------\n` +
      `${items.length} on the radar · ${items.filter((i) => i.confirmed).length} confirmed · ` +
      `${discovered.length} remembered from feeds\n` +
      `(Preview only — nothing was posted to Discord.)\n`
  );
  process.exit(0);
})().catch((err) => {
  console.error("\nShowcase preview failed:", err.message || err);
  process.exit(1);
});
