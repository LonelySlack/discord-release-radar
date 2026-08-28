/**
 * Lucky-draw wheel: a shared board where everyone drops in what they might
 * play, then anyone can spin it for a random pick. Built for "what are we
 * playing tonight?" arguments, but the entries are free text so it works for
 * anything (food, films, who buys the drinks).
 *
 * State lives per message, mirrored into the meta table so a restart doesn't
 * kill an in-progress board.
 */
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const crypto = require("crypto");
const { getMetaValue, setMetaValue } = require("./db");
const log = require("./logger");

const KEY = "wheel:boards";
const MAX_BOARDS = 25; // how many wheels we keep clickable
const MAX_ENTRIES = 25;
const MAX_LABEL = 80;
const COLOR_IDLE = 0x5865f2;
const COLOR_SPIN = 0xfaa61a;
const COLOR_WIN = 0x57f287;

const boards = new Map(); // messageId -> { entries: [{ name, by }] }

function persist() {
  try {
    setMetaValue(KEY, JSON.stringify([...boards.entries()]));
  } catch (err) {
    log.error("wheel persist failed", err);
  }
}

function load() {
  try {
    const raw = getMetaValue(KEY);
    if (!raw) return;
    for (const [id, board] of JSON.parse(raw)) boards.set(id, board);
    log.info("wheel boards loaded", { boards: boards.size });
  } catch (err) {
    log.error("wheel load failed", err);
  }
}

function save(messageId, board) {
  boards.set(messageId, board);
  while (boards.size > MAX_BOARDS) {
    boards.delete(boards.keys().next().value);
  }
  persist();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Split typed text into entries. Accepts commas or newlines so people can
 * paste a list however they like.
 */
function parseEntries(text) {
  return (text || "")
    .split(/[,\n]/)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((s) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s));
}

/** Add entries, skipping ones already on the board (case-insensitive). */
function addEntries(board, names, by) {
  const existing = new Set(board.entries.map((e) => e.name.toLowerCase()));
  const added = [];
  for (const name of names) {
    if (board.entries.length >= MAX_ENTRIES) break;
    if (existing.has(name.toLowerCase())) continue;
    existing.add(name.toLowerCase());
    board.entries.push({ name, by });
    added.push(name);
  }
  return added;
}

function buildWheelEmbed(board, { winner = null, highlight = null } = {}) {
  const { entries } = board;
  const embed = new EmbedBuilder().setTimestamp(new Date());

  if (winner) {
    embed
      .setTitle("🎉 We have a winner")
      .setColor(COLOR_WIN)
      .setDescription(`## ${winner.name}\nPicked from **${entries.length}** entries.`)
      .setFooter({ text: `Suggested by ${winner.by} · spin again anytime` });
    return embed;
  }

  embed
    .setTitle("🎡 Lucky Draw")
    .setColor(highlight ? COLOR_SPIN : COLOR_IDLE);

  if (!entries.length) {
    embed.setDescription(
      "Nothing on the wheel yet.\nHit **➕ Add** to throw in a game — everyone can add."
    );
    return embed;
  }

  const lines = entries.map((e, i) => {
    const active = highlight && highlight.name === e.name;
    const label = active ? `**${e.name}**` : e.name;
    return `${active ? "▸" : "`" + String(i + 1).padStart(2, " ") + "`"} ${label}`;
  });

  embed.setDescription(
    highlight ? "🎲 Spinning…" : "Everyone can add. Hit **🎲 Spin** when you're ready."
  );

  // A full wheel of long names overruns Discord's 1024-char field cap, so the
  // list rolls over into continuation fields.
  let chunk = [];
  let len = 0;
  const flush = (first) => {
    if (!chunk.length) return;
    embed.addFields({
      name: first ? `On the wheel (${entries.length})` : "​",
      value: chunk.join("\n"),
    });
    chunk = [];
    len = 0;
  };
  let isFirst = true;
  for (const line of lines) {
    if (chunk.length && len + line.length + 1 > 1000) {
      flush(isFirst);
      isFirst = false;
    }
    chunk.push(line);
    len += line.length + 1;
  }
  flush(isFirst);

  return embed;
}

function buildWheelRows(board, { disabled = false } = {}) {
  const canSpin = board.entries.length >= 2;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("wheel:add")
        .setLabel("Add")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || board.entries.length >= MAX_ENTRIES),
      new ButtonBuilder()
        .setCustomId("wheel:spin")
        .setLabel("Spin")
        .setEmoji("🎲")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled || !canSpin),
      new ButtonBuilder()
        .setCustomId("wheel:reset")
        .setLabel("Clear")
        .setEmoji("♻️")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled || !board.entries.length)
    ),
  ];
}

/** `/wheel` — post a fresh board, optionally pre-filled. */
async function createWheel(interaction) {
  const board = { entries: [] };
  const prefill = parseEntries(interaction.options.getString("options"));
  if (prefill.length) {
    addEntries(board, prefill, interaction.user.displayName || interaction.user.username);
  }

  const message = await interaction.reply({
    embeds: [buildWheelEmbed(board)],
    components: buildWheelRows(board),
    withResponse: true,
  });

  // Resolve the message id across discord.js response shapes.
  const id =
    message?.resource?.message?.id ||
    message?.id ||
    (await interaction.fetchReply()).id;

  save(id, board);
  log.info("wheel created", { messageId: id, prefilled: board.entries.length });
}

async function openAddModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(`wheel:addmodal:${interaction.message.id}`)
    .setTitle("Add to the wheel")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("names")
          .setLabel("Game(s) — separate with commas")
          .setPlaceholder("Valorant, Deep Rock Galactic, Lethal Company")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(400)
          .setRequired(true)
      )
    );
  await interaction.showModal(modal);
}

async function handleAddModal(interaction) {
  const messageId = interaction.customId.split(":")[2];
  const board = boards.get(messageId);
  if (!board) return expired(interaction);

  const names = parseEntries(interaction.fields.getTextInputValue("names"));
  const added = addEntries(
    board,
    names,
    interaction.user.displayName || interaction.user.username
  );
  save(messageId, board);

  // Update the board itself, then confirm privately so the channel stays clean.
  const message = await interaction.channel.messages.fetch(messageId);
  await message.edit({
    embeds: [buildWheelEmbed(board)],
    components: buildWheelRows(board),
  });

  const skipped = names.length - added.length;
  await interaction.reply({
    content: added.length
      ? `Added **${added.join("**, **")}**.${skipped ? ` (${skipped} already on the wheel)` : ""}`
      : "Those are already on the wheel.",
    flags: MessageFlags.Ephemeral,
  });
}

/** Spin: a few teaser frames, then land on the winner. */
async function spinWheel(interaction, board) {
  const { entries } = board;
  const winner = entries[crypto.randomInt(entries.length)];

  // Lock the buttons while it spins so nobody edits mid-roll.
  await interaction.update({
    embeds: [buildWheelEmbed(board, { highlight: entries[crypto.randomInt(entries.length)] })],
    components: buildWheelRows(board, { disabled: true }),
  });

  for (let i = 0; i < 2; i++) {
    await sleep(850);
    await interaction.editReply({
      embeds: [
        buildWheelEmbed(board, {
          highlight: entries[crypto.randomInt(entries.length)],
        }),
      ],
      components: buildWheelRows(board, { disabled: true }),
    });
  }

  await sleep(850);
  await interaction.editReply({
    embeds: [buildWheelEmbed(board, { winner })],
    components: buildWheelRows(board),
  });

  log.info("wheel spun", { winner: winner.name, entries: entries.length });
}

function expired(interaction) {
  return interaction.reply({
    content:
      "⌛ This wheel is no longer tracked. Run `/wheel` to start a fresh one.",
    flags: MessageFlags.Ephemeral,
  });
}

async function handleWheelButton(interaction) {
  const action = interaction.customId.split(":")[1];

  if (action === "add") {
    // The modal needs the board to still exist before we bother opening it.
    if (!boards.get(interaction.message.id)) return expired(interaction);
    return openAddModal(interaction);
  }

  const board = boards.get(interaction.message.id);
  if (!board) return expired(interaction);

  if (action === "reset") {
    board.entries = [];
    save(interaction.message.id, board);
    return interaction.update({
      embeds: [buildWheelEmbed(board)],
      components: buildWheelRows(board),
    });
  }

  if (action === "spin") {
    if (board.entries.length < 2) {
      return interaction.reply({
        content: "Put at least two things on the wheel first.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return spinWheel(interaction, board);
  }
}

load();

module.exports = { createWheel, handleWheelButton, handleAddModal };
