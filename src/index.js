const { Client, GatewayIntentBits, Events, ActivityType } = require("discord.js");
const config = require("./config");
const { startScheduler } = require("./scheduler");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  console.log(`Posting to channel ${config.channelId}`);
  console.log(
    `Primary region: ${config.primaryRegion} | Fallbacks: ${config.fallbackRegions.join(", ")}`
  );

  c.user.setActivity("new releases · MY", { type: ActivityType.Watching });
  startScheduler(client);
});

client.on(Events.Error, (err) => {
  console.error("Discord client error:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

client.login(config.discordToken).catch((err) => {
  console.error("Login failed:", err.message);
  process.exit(1);
});
