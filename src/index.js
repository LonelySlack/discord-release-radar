const { Client, GatewayIntentBits, Events, ActivityType } = require("discord.js");
const config = require("./config");
const log = require("./logger");
const { startScheduler } = require("./scheduler");
const { registerInteractions } = require("./interactions");
const { registerCommands } = require("./commands");

log.initLogger(config.weeklyLogDir);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (c) => {
  log.info("logged in", {
    user: c.user.tag,
    channelId: config.channelId,
    primaryRegion: config.primaryRegion,
    timezone: config.timezone,
    digestCron: config.digestCron,
  });

  c.user.setActivity("today's releases · MY", { type: ActivityType.Watching });
  registerInteractions(client);
  registerCommands(client).catch((err) => log.error("command registration", err));
  startScheduler(client);
});

client.on(Events.Error, (err) => {
  log.error("Discord client error", err);
});

process.on("unhandledRejection", (err) => {
  log.error("Unhandled rejection", err instanceof Error ? err : new Error(String(err)));
});

client.login(config.discordToken).catch((err) => {
  log.error("Login failed", err);
  process.exit(1);
});
