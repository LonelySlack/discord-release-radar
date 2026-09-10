const { Events, MessageFlags } = require("discord.js");
const { buildDigestPage, buildBoardRows, FILTERS } = require("./notifier");
const { isDayKey, DAY_KEYS } = require("./time");
const { recall } = require("./digestStore");
const { createWheel, handleWheelButton, handleAddModal } = require("./wheel");
const { buildShowcaseBoard } = require("./showcaseNotifier");
const { collectShowcaseBoard } = require("./scheduler");
const log = require("./logger");

/**
 * `/showcases` — the board on demand. Answers privately unless asked to share,
 * so checking "when is the next Direct" mid-conversation costs the channel
 * nothing. The feeds behind it can take a few seconds, hence the defer.
 */
async function showShowcases(interaction) {
  const share = interaction.options.getBoolean("share") ?? false;
  await interaction.deferReply({
    flags: share ? undefined : MessageFlags.Ephemeral,
  });

  const { items, announcements } = await collectShowcaseBoard();
  await interaction.editReply({
    content: "## 📡 Showcase Radar",
    embeds: [buildShowcaseBoard(items, announcements)],
  });
}

/**
 * Wire up the digest's calendar strip, category tabs and page arrows. Every
 * click edits the board in place (interaction.update) — no new messages, so the
 * channel keeps exactly one digest per slot no matter how much someone clicks
 * around.
 */
function registerInteractions(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    // Lucky-draw wheel: slash command, its buttons, and its add-entry modal.
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === "wheel") {
        return await createWheel(interaction);
      }
      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "showcases"
      ) {
        return await showShowcases(interaction);
      }
      if (interaction.isButton() && interaction.customId.startsWith("wheel:")) {
        return await handleWheelButton(interaction);
      }
      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith("wheel:addmodal:")
      ) {
        return await handleAddModal(interaction);
      }
    } catch (err) {
      log.error("command interaction failed", err);
      const message = "That didn't work — try again in a moment.";
      try {
        // A deferred reply has to be edited; a fresh one has to be created.
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: message, embeds: [] });
        } else {
          await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }
      } catch {
        /* ignore */
      }
      return;
    }

    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith("rr:")) return;

    // The disabled page counter — nothing to do.
    if (interaction.customId === "rr:noop") return;

    // Every board button carries its whole view in the id:
    //   rr:day:<day>:<filter>:0            calendar strip
    //   rr:view:<day>:<filter>:0           category tab
    //   rr:prev|next:<day>:<filter>:<page> page arrows
    // The action only decides which control was clicked — the state that
    // follows is read the same way for all of them.
    const [, action, rawDay, rawFilter, rawPage] = interaction.customId.split(":");
    if (!["day", "view", "prev", "next"].includes(action)) return;

    const day = isDayKey(rawDay) ? rawDay : "today";
    const filter = FILTERS.some((f) => f.key === rawFilter) ? rawFilter : "all";
    const page = Number.parseInt(rawPage, 10) || 0;

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

      const { embed, pageCount, page: shown } = buildDigestPage(
        data.releases,
        data.ymd,
        { slot: data.slot, day, filter, page }
      );

      await interaction.update({
        embeds: [embed],
        components: buildBoardRows(day, filter, shown, pageCount),
      });
    } catch (err) {
      log.error("board interaction failed", err);
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

  log.info("interactions registered", {
    filters: FILTERS.map((f) => f.key),
    days: DAY_KEYS,
  });
}

module.exports = { registerInteractions };
