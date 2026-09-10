/**
 * Time helpers for Malaysia-first daily digests.
 * Asia/Kuala_Lumpur has no DST (fixed UTC+8) — we still use Intl for labels.
 */

/** New Date shifted by n whole days (UTC-safe; day boundaries resolved later per-zone). */
function addDays(n, date = new Date()) {
  return new Date(date.getTime() + n * 24 * 60 * 60 * 1000);
}

function localYmd(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date); // YYYY-MM-DD
}

function localParts(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  }).formatToParts(date);

  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return map;
}

/**
 * Start/end of "today" in the given IANA zone as UTC ms (and unix seconds).
 * Uses fixed offset from a noon probe so calendar day boundaries are correct.
 */
function dayBounds(timeZone, date = new Date()) {
  const ymd = localYmd(timeZone, date);
  const [y, m, d] = ymd.split("-").map(Number);

  // Probe: construct as if local wall time were UTC, then correct by offset
  const probeUtc = Date.UTC(y, m - 1, d, 12, 0, 0);
  const offsetMs = tzOffsetMs(timeZone, new Date(probeUtc));
  const startMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;

  return {
    ymd,
    startMs,
    endMs,
    startSec: Math.floor(startMs / 1000),
    endSec: Math.floor(endMs / 1000),
  };
}

/** Offset of timeZone relative to UTC at `date` (ms to add to local to get UTC? → local = utc + offset) */
function tzOffsetMs(timeZone, date) {
  // Difference between the same instant formatted in zone vs UTC components
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asIfUtc - date.getTime();
}

function formatLocalTime(timeZone, ms) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

function formatLocalDateLabel(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** Local hour 0-23 in timeZone */
function localHour(timeZone, date = new Date()) {
  return Number(localParts(timeZone, date).hour);
}

/**
 * morning | evening from local hour and configured digest hours.
 * Midpoint between the two hours decides the switch.
 */
function digestSlot(timeZone, digestHours = [9, 20], date = new Date()) {
  const hours = [...digestHours].sort((a, b) => a - b);
  if (hours.length <= 1) return "morning";
  const hour = localHour(timeZone, date);
  const mid = (hours[0] + hours[hours.length - 1]) / 2;
  return hour < mid ? "morning" : "evening";
}

function slotLabel(slot) {
  return slot === "evening" ? "Evening update" : "Morning board";
}

/** ISO week key e.g. 2026-W31 */
function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Thursday in current week decides the year
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * The board covers three calendar days. These drive the calendar row at the
 * top of the digest, the per-day fetches, and the section headings — keep
 * them in display order (oldest first).
 */
const DAY_TABS = [
  { key: "yesterday", offset: -1, emoji: "⬅️", name: "Yesterday" },
  { key: "today", offset: 0, emoji: "📍", name: "Today" },
  { key: "tomorrow", offset: 1, emoji: "➡️", name: "Tomorrow" },
];

const DAY_KEYS = DAY_TABS.map((d) => d.key);

/** The tab record for a key, defaulting to today for anything unrecognised. */
function dayTab(key) {
  return DAY_TABS.find((d) => d.key === key) || DAY_TABS[1];
}

function isDayKey(key) {
  return DAY_KEYS.includes(key);
}

/** The Date that a day key points at, relative to `now`. */
function dateForDay(key, now = new Date()) {
  return addDays(dayTab(key).offset, now);
}

/** Local YYYY-MM-DD for a day key. */
function ymdForDay(timeZone, key, now = new Date()) {
  return localYmd(timeZone, dateForDay(key, now));
}

/** Compact calendar-button label, e.g. "Thu 27 Aug". */
function formatDayTabLabel(timeZone, key, now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(dateForDay(key, now));
}

/** The word a section heading uses: "yesterday" | "today" | "tomorrow". */
function dayWord(key) {
  return dayTab(key).key;
}

/**
 * Epoch ms for a wall-clock time in a given zone — "2026-09-24 10:00 in
 * Asia/Tokyo" as an instant. Showcases publish their times in the host's zone,
 * and Discord's <t:...> timestamps want an instant so every viewer sees it in
 * their own.
 */
function zonedTimeToEpochMs(timeZone, ymd, hour = 0, minute = 0) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  if (!y || !m || !d) return NaN;
  const naive = Date.UTC(y, m - 1, d, hour, minute, 0);
  // One correction is enough away from a DST seam, and a second pass fixes the
  // hour on the two days a year that sit inside one.
  let ms = naive - tzOffsetMs(timeZone, new Date(naive));
  ms = naive - tzOffsetMs(timeZone, new Date(ms));
  return ms;
}

/** Whole calendar days from one YYYY-MM-DD to another (b - a). */
function daysBetweenYmd(a, b) {
  const toUtc = (ymd) => {
    const [y, m, d] = String(ymd).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const from = toUtc(a);
  const to = toUtc(b);
  if (Number.isNaN(from) || Number.isNaN(to)) return NaN;
  return Math.round((to - from) / 86400000);
}

module.exports = {
  addDays,
  zonedTimeToEpochMs,
  daysBetweenYmd,
  tzOffsetMs,
  localYmd,
  localParts,
  dayBounds,
  formatLocalTime,
  formatLocalDateLabel,
  localHour,
  digestSlot,
  slotLabel,
  isoWeekKey,
  DAY_TABS,
  DAY_KEYS,
  dayTab,
  isDayKey,
  dateForDay,
  ymdForDay,
  formatDayTabLabel,
  dayWord,
};
