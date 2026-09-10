/**
 * Upcoming tech and gaming showcases — Nintendo Directs, State of Plays, Xbox
 * showcases, Apple events, Xiaomi launches, the AI keynotes.
 *
 * This is deliberately NOT an API. Nobody publishes a machine-readable feed of
 * "every showcase that will happen", and the events that matter most are
 * announced two days out on a company blog. So the catalog is a file you edit
 * (`config/showcases.json`), split into two kinds of knowledge:
 *
 *   confirmed — someone announced a date. These fire countdown alerts.
 *   expected  — the annual rhythm (there is always a September Apple event).
 *               Drawn with a ~ and never alerted, because an alert on a guess
 *               is worse than no alert at all.
 *
 * `providers/showcaseFeeds.js` upgrades the second into the first on its own
 * when an official blog announces a date.
 */
const path = require("path");
const fs = require("fs");
const config = require("../config");
const log = require("../logger");
const { localYmd, daysBetweenYmd, zonedTimeToEpochMs } = require("../time");

const CATALOG_PATH = path.join(__dirname, "..", "..", "config", "showcases.json");

const CATEGORIES = {
  gaming: { emoji: "🎮", label: "Gaming", color: 0x57f287 },
  tech: { emoji: "💻", label: "Tech", color: 0x5865f2 },
  mobile: { emoji: "📱", label: "Mobile", color: 0xeb459e },
  ai: { emoji: "🤖", label: "AI", color: 0xfee75c },
};

function categoryMeta(key) {
  return CATEGORIES[key] || { emoji: "📡", label: "Event", color: 0x99aab5 };
}

/** Re-read the catalog when it changes on disk, so edits need no restart. */
let cache = { mtimeMs: 0, data: null };

function loadCatalog() {
  try {
    const { mtimeMs } = fs.statSync(CATALOG_PATH);
    if (cache.data && cache.mtimeMs === mtimeMs) return cache.data;
    const data = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
    cache = { mtimeMs, data };
    log.info("showcase catalog loaded", {
      dated: (data.showcases || []).length,
      recurring: (data.recurring || []).length,
    });
    return data;
  } catch (err) {
    log.error("showcase catalog unreadable", err);
    return cache.data || { showcases: [], recurring: [] };
  }
}

/* ------------------------------------------------------------------ dates */

function ymd(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * "second Thursday of December", "last Tuesday of May". week -1 means last;
 * a week that runs off the end of the month clamps to the final matching day.
 */
function nthWeekday(year, month, weekday, week) {
  if (week === -1) {
    const last = daysInMonth(year, month);
    const dow = new Date(Date.UTC(year, month - 1, last)).getUTCDay();
    return last - ((dow - weekday + 7) % 7);
  }
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - firstDow + 7) % 7) + (week - 1) * 7;
  const last = daysInMonth(year, month);
  return day > last ? day - 7 : day;
}

/**
 * A recurring rule's date in a given year. Month-precision rules have no real
 * day, so they anchor on the 15th — the middle of the month they'll land in,
 * which is what "expected mid Oct" is actually claiming.
 */
function ruleDate(rule, year, month) {
  if (Number.isFinite(rule.day)) return ymd(year, month, rule.day);
  if (Number.isFinite(rule.weekday)) {
    return ymd(year, month, nthWeekday(year, month, rule.weekday, rule.week || 1));
  }
  return ymd(year, month, 15);
}

function ruleMonths(rule) {
  if (Array.isArray(rule.months) && rule.months.length) return rule.months;
  return [rule.month].filter(Number.isFinite);
}

/**
 * Every occurrence of a recurring entry from today out to the window's end.
 * Walks this year and the next two so a January event still shows up when the
 * window is opened in December.
 */
function occurrencesFor(entry, todayYmd, horizonYmd) {
  const rule = entry.rule || {};
  const startYear = Number(todayYmd.slice(0, 4));
  const out = [];

  for (let year = startYear; year <= startYear + 2; year += 1) {
    for (const month of ruleMonths(rule)) {
      const date = ruleDate(rule, year, month);
      if (daysBetweenYmd(todayYmd, date) < 0) continue;
      if (daysBetweenYmd(date, horizonYmd) < 0) continue;
      out.push({ ...entry, date, confirmed: false, occurrenceYear: year, month });
    }
  }
  return out;
}

/* ----------------------------------------------------------------- labels */

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDay(date, withWeekday = true) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()];
  return `${withWeekday ? `${weekday} ` : ""}${d} ${MONTH_NAMES[m - 1]}`;
}

/** "early / mid / late Oct" — the honest resolution of a month-level guess. */
function formatMonthish(date) {
  const [, m, d] = date.split("-").map(Number);
  const third = d <= 10 ? "early" : d <= 20 ? "mid" : "late";
  return `${third} ${MONTH_NAMES[m - 1]}`;
}

/**
 * How the date is written on the board. A confirmed date says the day. An
 * estimate says only as much as the rule actually knows — a week, or a third
 * of a month — so the board never implies more certainty than it has.
 */
function dateLabel(item) {
  if (item.confirmed) {
    const start = formatDay(item.date);
    if (item.endDate && item.endDate !== item.date) {
      return `${start}–${formatDay(item.endDate, false)}`;
    }
    return start;
  }
  const precision = item.rule?.precision || "month";
  if (precision === "day") return `~${formatDay(item.date)}`;
  if (precision === "week") return `~week of ${formatDay(item.date, false)}`;
  return `~${formatMonthish(item.date)}`;
}

/**
 * How soon, stated no more precisely than the entry actually knows.
 *
 * This is the difference between a calendar and a rumour mill. A confirmed date
 * counts days, because it earned that. A month-level estimate must NOT — a
 * yearly pattern anchored to the middle of the month once rendered as
 * "State of Play · in 5 days" for a show that had already aired the week
 * before. It says "expected in Sep" instead, and lets the reader hold it as
 * loosely as it deserves.
 */
function countdownLabel(item, todayYmd) {
  const days = item.daysUntil;
  if (item.live) return "on now";

  if (item.datePrecision === "month") {
    const month = MONTH_NAMES[Number(item.date.slice(5, 7)) - 1];
    const delta =
      Number(item.date.slice(0, 4)) * 12 + Number(item.date.slice(5, 7)) -
      (Number(todayYmd.slice(0, 4)) * 12 + Number(todayYmd.slice(5, 7)));
    if (delta <= 0) return "expected this month";
    if (delta === 1) return "expected next month";
    return `expected in ${month}`;
  }

  if (item.datePrecision === "week") {
    if (days <= 7) return "this week";
    if (days < 14) return "next week";
    if (days < 60) return `in ~${Math.round(days / 7)} weeks`;
    return `in ~${Math.round(days / 30)} months`;
  }

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  // Seven still counts the days: it's the first alert mark, and "next week"
  // reads softer than the alert that fires on the same morning.
  if (days <= 7) return `in ${days} days`;
  if (days < 14) return "next week";
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

/* ---------------------------------------------------------------- assembly */

/**
 * Turn a catalog row into the shape the notifier renders. `startsAt` only
 * exists when a confirmed entry carries a clock time — that's what lets the
 * alert print a Discord timestamp that reads in each viewer's own zone.
 */
function normalize(entry, todayYmd) {
  const meta = categoryMeta(entry.category);
  const endDate = entry.endDate || entry.date;
  const daysUntil = daysBetweenYmd(todayYmd, entry.date);

  let startsAt = null;
  if (entry.confirmed && entry.time) {
    const [hh, mm] = String(entry.time).split(":").map(Number);
    const ms = zonedTimeToEpochMs(
      entry.timezone || config.timezone,
      entry.date,
      hh || 0,
      mm || 0
    );
    if (Number.isFinite(ms)) startsAt = ms;
  }

  const item = {
    ...entry,
    id: entry.occurrenceYear ? `${entry.id}-${entry.occurrenceYear}-${entry.month}` : entry.id,
    seriesId: entry.series || entry.id,
    category: entry.category || "tech",
    categoryEmoji: meta.emoji,
    categoryLabel: meta.label,
    color: meta.color,
    endDate,
    daysUntil,
    // A confirmed entry states a day; an estimate states only what its rule
    // knows. Everything downstream — wording, bucketing — keys off this.
    datePrecision: entry.confirmed ? "day" : entry.rule?.precision || "month",
    // A multi-day show is "on now" from its first day until its last.
    live: daysUntil <= 0 && daysBetweenYmd(todayYmd, endDate) >= 0,
    startsAt,
  };
  item.dateLabel = dateLabel(item);
  item.countdown = countdownLabel(item, todayYmd);
  return item;
}

/**
 * The board's contents: everything happening between today and the horizon,
 * soonest first, confirmed dates winning over the estimate for the same series.
 *
 * @param {object} [opts]
 * @param {object[]} [opts.extra] feed-discovered events to fold in
 * @param {Date} [opts.now]
 */
function collectShowcases(opts = {}) {
  const now = opts.now || new Date();
  const todayYmd = localYmd(config.timezone, now);
  const horizon = new Date(now.getTime() + config.showcaseWindowDays * 86400000);
  const horizonYmd = localYmd(config.timezone, horizon);

  const catalog = loadCatalog();
  const dated = [...(catalog.showcases || []), ...(opts.extra || [])]
    .filter((e) => e && e.date)
    .map((e) => ({ ...e, confirmed: e.confirmed !== false }));

  // A show that started yesterday and runs all week is still news; one that
  // finished is not.
  const stillRelevant = (e) =>
    daysBetweenYmd(todayYmd, e.endDate || e.date) >= 0 &&
    daysBetweenYmd(e.date, horizonYmd) >= 0;

  const confirmed = dated.filter(stillRelevant);

  // Months already spoken for by a real date — the estimate for that series has
  // been overtaken by news and would only muddy the board. Note this counts
  // dates that have already PASSED: a Direct that aired on the 9th is exactly
  // why the board must stop promising one "around the 15th".
  const claimed = new Set(
    dated.map((e) => `${e.series || e.id}:${e.date.slice(0, 7)}`)
  );

  const expected = [];
  for (const entry of catalog.recurring || []) {
    for (const occ of occurrencesFor(entry, todayYmd, horizonYmd)) {
      const key = `${occ.series || occ.id}:${occ.date.slice(0, 7)}`;
      if (claimed.has(key)) continue;
      expected.push(occ);
    }
  }

  const items = [...confirmed, ...expected]
    .map((e) => normalize(e, todayYmd))
    .filter((e) => Number.isFinite(e.daysUntil))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));

  return items;
}

/** Only the ones a countdown alert is allowed to fire for. */
function alertableShowcases(items) {
  return items.filter((i) => i.confirmed && i.daysUntil >= 0);
}

module.exports = {
  collectShowcases,
  alertableShowcases,
  categoryMeta,
  countdownLabel,
  dateLabel,
  formatDay,
  CATEGORIES,
  CATALOG_PATH,
};
