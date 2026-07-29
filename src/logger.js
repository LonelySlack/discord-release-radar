/**
 * Dual logger: console (picked up by systemd → release-radar.log)
 * + weekly rolling ops files for easy "what happened this week" review.
 */
const fs = require("fs");
const path = require("path");
const { isoWeekKey } = require("./time");

let logDir = null;
let weekStats = {
  week: null,
  digests: 0,
  items: 0,
  errors: 0,
  polls: 0,
};

function initLogger(dir) {
  logDir = dir;
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  weekStats.week = isoWeekKey();
}

function weekFile() {
  const key = isoWeekKey();
  if (weekStats.week !== key) {
    weekStats = { week: key, digests: 0, items: 0, errors: 0, polls: 0 };
  }
  return path.join(logDir, `${key}.log`);
}

function stamp() {
  return new Date().toISOString();
}

function writeWeekly(level, message, extra) {
  if (!logDir) return;
  const line =
    extra !== undefined
      ? `${stamp()} [${level}] ${message} ${safeJson(extra)}\n`
      : `${stamp()} [${level}] ${message}\n`;
  try {
    fs.appendFileSync(weekFile(), line, "utf8");
  } catch (err) {
    console.error("[logger] failed to write weekly log:", err.message);
  }
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

function info(message, extra) {
  if (extra !== undefined) console.log(`[info] ${message}`, extra);
  else console.log(`[info] ${message}`);
  writeWeekly("INFO", message, extra);
}

function warn(message, extra) {
  if (extra !== undefined) console.warn(`[warn] ${message}`, extra);
  else console.warn(`[warn] ${message}`);
  writeWeekly("WARN", message, extra);
}

function error(message, errOrExtra) {
  const extra =
    errOrExtra instanceof Error
      ? { error: errOrExtra.message, stack: errOrExtra.stack?.split("\n").slice(0, 4) }
      : errOrExtra;
  if (extra !== undefined) console.error(`[error] ${message}`, extra);
  else console.error(`[error] ${message}`);
  weekStats.errors += 1;
  writeWeekly("ERROR", message, extra);
}

function pollResult(summary) {
  weekStats.polls += 1;
  if (summary.sent) weekStats.digests += 1;
  if (summary.itemCount) weekStats.items += summary.itemCount;
  info("poll", {
    ...summary,
    weekTotals: { ...weekStats },
  });
}

function getWeekStats() {
  return { ...weekStats, week: isoWeekKey() };
}

/** Human-readable weekly summary block (for Discord or console). */
function formatWeekSummary() {
  const s = getWeekStats();
  return [
    `Week ${s.week}`,
    `• polls: ${s.polls}`,
    `• digests posted: ${s.digests}`,
    `• items listed: ${s.items}`,
    `• errors: ${s.errors}`,
  ].join("\n");
}

module.exports = {
  initLogger,
  info,
  warn,
  error,
  pollResult,
  getWeekStats,
  formatWeekSummary,
};
