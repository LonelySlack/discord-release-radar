/**
 * Slash command registration. Commands are registered per-guild because guild
 * commands appear instantly, where global ones can take up to an hour to show.
 */
const { SlashCommandBuilder } = require("discord.js");
const log = require("./logger");

const commands = [
  new SlashCommandBuilder()
    .setName("wheel")
    .setDescription("Spin a lucky-draw wheel to pick a game (or anything) at random")
    .addStringOption((opt) =>
      opt
        .setName("options")
        .setDescription("Optional starting entries, separated by commas")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("showcases")
    .setDescription("Upcoming gaming + tech showcases (Directs, State of Play, Apple, AI keynotes)")
    .addBooleanOption((opt) =>
      opt
        .setName("share")
        .setDescription("Post it in the channel instead of only showing it to you")
        .setRequired(false)
    ),
  // Its own command rather than a section of /showcases: the board is capped at
  // 90 days, and the question a sale calendar answers ("wait for the Summer
  // Sale?") is usually about a month further out than that.
  new SlashCommandBuilder()
    .setName("sales")
    .setDescription("Game store sale calendar — Steam, PlayStation, Xbox, eShop, GOG, Epic")
    .addStringOption((opt) =>
      opt
        .setName("store")
        .setDescription("Only one storefront")
        .setRequired(false)
        .addChoices(
          { name: "Steam", value: "Steam" },
          { name: "PlayStation", value: "PlayStation" },
          { name: "Xbox", value: "Xbox" },
          { name: "Nintendo eShop", value: "Nintendo" },
          { name: "GOG", value: "GOG" },
          { name: "Epic Games Store", value: "Epic" }
        )
    )
    .addBooleanOption((opt) =>
      opt
        .setName("share")
        .setDescription("Post it in the channel instead of only showing it to you")
        .setRequired(false)
    ),
];

async function registerCommands(client) {
  const body = commands.map((c) => c.toJSON());
  const names = commands.map((c) => c.name);

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set(body);
      log.info("slash commands registered", { guild: guild.name, commands: names });
    } catch (err) {
      // Almost always a missing `applications.commands` scope on the invite —
      // the bot has to be re-invited with it before slash commands can exist.
      log.error(`slash command registration failed for ${guild.name}`, err);
    }
  }
}

module.exports = { registerCommands, commands };
