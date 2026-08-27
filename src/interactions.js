const { Events, MessageFlags } = require("discord.js");
const { buildDailyDigestEmbeds, FILTERS } = require("./notifier");
const { recall } = require("./digestStore");
const log = require("./logger");

/**
 * Wire up the digest filter buttons. Each click sends a private (ephemeral)
 * reply showing just that category, so the shared channel stays clean.
 */
function registerInteractions(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith("rr:filter:")) return;

    const key = interaction.customId.split(":")[2] || "all";
    const filter = FILTERS.some((f) => f.key === key) ? key : "all";

    try {
      const data = recall(interaction.message.id);
      if (!data) {
        await interaction.reply({
          content:
            "⌛ This digest has expired (the bot restarted since it was posted). Wait for the next board — its buttons will work.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embeds = buildDailyDigestEmbeds(
        data.releases,
        data.ymd,
        data.slot,
        filter
      );

      await interaction.reply({
        embeds: embeds.slice(0, 10),
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      log.error("filter interaction failed", err);
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: "Something went wrong building that view.",
            flags: MessageFlags.Ephemeral,
          });
        } catch {
          /* ignore */
        }
      }
    }
  });

  log.info("interactions registered", { filters: FILTERS.map((f) => f.key) });
}

module.exports = { registerInteractions };
