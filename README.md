# Discord Release Radar

Lightweight **Node.js** Discord bot that posts **one daily digest** into **`#releases`**:

- 📅 **Calendar row at the top** — tap **⬅️ yesterday · 📍 today · ➡️ tomorrow** (each button shows its real date) to move the whole board between the three days
- 🎌 **Anime** airing on the selected day (AniList schedule, local MY times) — shows both the English **and** Japanese/native title, e.g. `Frieren 「葬送のフリーレン」`
- 🎬 **New on your services** — recent films that are actually streaming on your Netflix / Disney+ / Prime / HBO Max / Viu right now (TMDB), newest first
- 📺 **TV** airing on the selected day, on your services (TMDB)
- 🎟️ **Coming to cinemas** — upcoming theatrical releases in your region (TMDB), e.g. *Spider-Man: Brand New Day*
- 🎮 **Game releases** — recent + upcoming games. Works with **no API key** via Steam's public storefront (PC titles); add an optional free RAWG key for cross-platform coverage
- 📡 **Showcase Radar** — a **separate** post for upcoming showcases: Nintendo Directs, PlayStation State of Play, Xbox showcases, Apple events, Xiaomi launches, Google I/O and the other AI keynotes — with countdown alerts a week, five days, a day and the morning before
- 🗂️ **Filter buttons** underneath — tap **Anime / Movies / TV / Cinema / Games** to narrow the board to one category, so it never feels cluttered

Anime and TV are day-bound and change with the calendar tab. Movies, cinema and
games are rolling windows, so they stay put on every tab — the description
splits the two onto separate count lines.

**Why movies aren't day-bound:** TMDB has no "added to Netflix on *date*" field,
only a release date — and a film released today is in cinemas, not on a
subscription, so asking for "films released today that are streaming" returns
nothing, every day. So the section answers the question the data can actually
answer: recent releases (`MOVIE_WINDOW_DAYS`, default 90) that are on your
services *now*, newest first, with a popularity floor
(`MOVIE_MIN_POPULARITY`) to keep filler out. The TMDB provider ids are resolved
from `config/services.json` at runtime, so that file stays the only place you
list what you subscribe to.

The digest is **one message**: the calendar sits above the embed, the filters
and page arrows below it, and every click edits that same message in place.

Also keeps **weekly ops logs** (errors + poll history) under `~/logs/release-radar-weekly/`, with an optional Sunday Discord summary.

### Why Node.js (not Python)?

| | Node.js + discord.js | Python + discord.py |
|--|----------------------|---------------------|
| Idle RAM (typical small bot) | ~40–80 MB | ~60–120 MB |
| Discord ecosystem | Excellent | Excellent |
| Deploy on Ubuntu droplet | `node` + `pm2` | `python` + `venv` + `pm2`/`systemd` |
| Long-running websocket bot | Very common / well tuned | Also fine |

For a **24/7 notifier on a small DigitalOcean droplet**, Node is a bit leaner and the usual default. Both work; this project uses **Node.js**.

---

## Features

- **Malaysia-first (`MY`)** availability checks
- If a title is **not** on your services in MY, still notify when it is available on the **same brands in other countries** (SG, US, JP, …) — same subscription brand, different regional catalog
- Anime: notify **~30 minutes before** air time when AniList has a schedule
- Movies / TV: notify **when catalog data says it’s out** (exact clock times are rarely public)
- SQLite dedupe so you don’t get the same alert twice
- Your service list lives in `config/services.json` (Netflix, Disney+, Prime, HBO Max, Viu, iQIYI, Crunchyroll, Sun NXT, beIN, Astro, …)
- **Free & Subs** tab: Epic Games giveaways, new arrivals on Game Pass, and PlayStation Plus announcements — all keyless
- **Sale calendar**: every seasonal storefront sale (Steam, PlayStation, Xbox, eShop, GOG, Epic) on the Showcase Radar, plus **`/sales`** for a full year ahead

---

## Setup on this PC

### 1. Create a Discord bot

1. Open [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. **Bot** → **Reset Token** → copy token
3. **OAuth2 → URL Generator**
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Embed Links`, `View Channels`
4. Open the invite URL, add the bot to your server

### 2. Get channel ID

1. Discord → User Settings → Advanced → **Developer Mode** on  
2. Right-click your `#releases` channel → **Copy Channel ID**

### 3. TMDB API key (free)

1. Sign up at [themoviedb.org](https://www.themoviedb.org/)
2. Settings → API → request a key  
3. Use the **API Key (v3 auth)**

AniList needs **no key** — and neither does the fallback below.

#### Anime keeps working when AniList doesn't

Anime comes from **AniList** first. AniList's API goes down for days at a time
(most recently September 2026, answering every query with `403 — temporarily
disabled due to severe stability issues`), and when it does, the anime section
is the only part of the board that empties out.

So the bot falls back to **[AnimeSchedule](https://animeschedule.net)**, whose
`/api/v3/anime` endpoint is open and **needs no key either**. It carries the
same things the board shows: air times, English/native titles, scores, genres,
and real Crunchyroll / Netflix / Prime links.

The one thing it can't give is a published per-episode number, so those are
counted from the show's premiere and printed with a tilde — `~Ep 10/12`. A show
that took a mid-season break drifts past its own episode count; rather than
print a confidently wrong number, those rows fall back to `12 eps`.

The bot re-checks AniList every 30 minutes and switches back on its own the
moment it recovers. **There is nothing to configure and no key to add.**

### 3b. Games source (no key needed)

The **Games** section works out of the box with **no key** using Steam's public
storefront API (PC titles only). Nothing to configure.

Want cross-platform coverage (consoles too) with cleaner curation? Get a free
key at [rawg.io](https://rawg.io/apidocs) and set `RAWG_API_KEY=...` in `.env` —
the bot auto-switches to RAWG when a key is present. Force a source explicitly
with `GAME_SOURCE=steam` or `GAME_SOURCE=rawg`.

### 3c. Free & subscription games (no key needed)

The **Free & Subs** tab needs no keys and no configuration. Three sources feed it:

| Source | What you get | How |
|--------|--------------|-----|
| Epic Games | This week's giveaway + what replaces it | Public promotions endpoint |
| Xbox Game Pass | Games that just **entered** the catalog | Catalog list, diffed against the previous run |
| PlayStation Plus | The monthly line-up announcement | PlayStation Blog feed |

Three things worth knowing before you rely on it:

- **Epic** returns its whole promo carousel, most of which is ordinary sale
  stock. Only 100%-off promotions are treated as giveaways, so a half-price
  title never shows up claiming to be free.
- **Game Pass** publishes no "recently added" list, so additions come from
  diffing the full catalog against a snapshot in `meta`. The *first* run after
  enabling it stores a baseline and reports nothing — that is expected, not a
  fault. Console Game Pass isn't sold in MY or SG (the list returns empty), so
  it falls back through `FALLBACK_REGIONS` and labels the row with the market it
  came from. PC Game Pass serves MY directly.
- **PS Plus** has no catalog API at all. You get the announcement post and its
  date, not the individual games — the line-up only exists as prose in the post.

Turn any of them off by trimming `CONTENT_TYPES` (`epic`, `gamepass`, `psplus`).

### 3d. Showcase Radar (no key needed)

Showcases get their **own message**, not a row on the release board. A Nintendo
Direct three weeks out and the anime airing at 23:30 tonight are different kinds
of information — one you diarise, one you watch — and folding the first into the
second is how a Direct gets scrolled past.

So there are two posts:

| Post | When | What |
|------|------|------|
| **The board** | Once a day, `SHOWCASE_CRON` (09:30 by default) | Everything in the next `SHOWCASE_WINDOW_DAYS`, bucketed into *on now · this week · next 30 days · on the horizon* |
| **The countdown** | Each time an event crosses a lead mark | One event, loudly: `## ⏰ 5 days out · PlayStation State of Play` |

`SHOWCASE_LEAD_DAYS=7,5,1,0` fires four alerts per event — a week out to plan
around, five days to clear the evening, the eve, and the morning of. Each mark
fires **once**. It alerts on the *bucket* rather than the exact day, so an event
still gets its warning if the bot was down on the day it crossed the mark.

Also available on demand as **`/showcases`** (private by default;
`share: true` posts it to the channel), and **`/sales`** for the sale calendar.

#### Confirmed dates vs. the annual rhythm

There is no API for "every showcase that will happen" — the events that matter
most are announced **two days out on a company blog**. So the calendar in
`config/showcases.json` holds two different kinds of knowledge, and the board
never mixes them up:

- **Confirmed** — someone announced a date. Drawn plainly (`Thu 24 Sep`), and
  these are the **only** ones that fire countdown alerts. An alert on a guess is
  worse than no alert.
- **Expected** — the yearly pattern. There is always a September Apple event, so
  the board can say `~mid Sep · expected` and you can plan around it. These roll
  over on their own every year and are always drawn with a `~`.

The moment a real date lands for a series, that month's estimate disappears
instead of sitting next to it — including when the date is already **past**: a
Direct that aired on the 9th is exactly why the board must stop promising one
"around the 15th".

An estimate also **never states more than it knows**. A month-level pattern is
anchored to the middle of the month internally, but it is never rendered as
"in 5 days" and never lands in *This week* — it reads `~mid Oct · expected next
month`. Only a confirmed date counts days, because only a confirmed date has
earned it.

#### It picks up new announcements by itself

Four open, keyless feeds are watched for showcases that were just announced:

| Feed | Catches |
|------|---------|
| PlayStation Blog | State of Play, PlayStation Showcase |
| Xbox Wire | Xbox Games Showcase, Developer_Direct, Partner Preview |
| Apple Newsroom | "Apple special event" press releases |
| Nintendo (YouTube channel feed) | Directs — the video title carries the date outright (`Nintendo Direct 9.12.2026`) |

A match needs a real showcase phrase, not just a brand name, or a feed full of
sale posts would fill the board with noise. When a date can be read out of the
post it becomes a confirmed, alertable event; when it can't, the post still
surfaces under **📣 Just announced** with its link, rather than inventing a day.

**Discoveries are remembered, not just used.** These feeds are shallow — the
PlayStation Blog publishes five times a day, so its feed holds about *one day*
of posts, and a State of Play announced last Tuesday is invisible by Thursday.
Every discovery is therefore written into `meta` and kept for 120 days, so a
show that has already aired keeps suppressing predictions of itself long after
the post announcing it scrolled away.

Turn the feeds off with `SHOWCASE_FEEDS=false` to run on the curated file alone.

#### Game store sales

The seasonal sales live in the same catalog, under `recurring` with
`"category": "sale"`, and they get **their own section** at the bottom of the
board. A sale is a different kind of fact from a showcase: an event is a time you
have to be somewhere, a sale is a window you choose a moment inside — so the row
leads with the **deadline**, not the start.

```
🏷️ On sale now (2)
`~18 Dec–5 Jan` Steam Winter Sale · 🏷️ · **3 days left** · until Tue 5 Jan
`~18 Dec–8 Jan` Epic Holiday Sale (+ free game a day) · 🏷️ · **6 days left** · until Fri 8 Jan
```

Covered: **Steam** (Spring / Summer / Autumn / Winter, plus Next Fest),
**PlayStation Store** (Days of Play / Black Friday / Holiday), **Xbox** (Spring /
Ultimate Game Sale / Black Friday / Countdown), **Nintendo eShop** (MAR10 Day /
Summer / Cyber Deals / Big Holiday), **GOG** (Spring / Summer / Black Friday /
Big Winter) and **Epic** (Mega / Summer / Black Friday / Holiday).

Every one of them is an **estimate**, filed under `recurring` on purpose: no
storefront publishes its sale calendar, and they confirm about a week out. So the
dates are where the sale has actually landed the last few years, always drawn
with a `~`, and they **never fire countdown alerts**. When a store does announce,
add it to `showcases` with the real dates — then it alerts like anything else.

Two caps, not one, because November has a Black Friday sale on five storefronts
at once and a shared budget would push every Direct off the board:
`MAX_SHOWCASES=18` for events, `MAX_SALES=10` for sales.

**`/sales`** is the whole calendar, a year deep (`SALE_WINDOW_DAYS=365`) —
because "should I buy this now or wait for the Summer Sale" is a question asked
in September about June, and the 90-day board cannot answer it. `store: Steam`
narrows it to one storefront; private unless `share: true`.

#### Adding an event yourself

Drop it in the `showcases` array of `config/showcases.json` — the file is
re-read when it changes, so **no restart needed**:

```json
{
  "id": "state-of-play-2026-09",
  "series": "state-of-play",
  "name": "PlayStation State of Play",
  "brand": "PlayStation",
  "category": "gaming",
  "date": "2026-09-24",
  "time": "23:00",
  "timezone": "Asia/Kuala_Lumpur",
  "confirmed": true,
  "url": "https://blog.playstation.com/"
}
```

`time` + `timezone` are optional; with them the countdown prints a Discord
timestamp that reads in **each viewer's own zone**, which is the whole problem
with a Japanese 07:00 stream. `category` is `gaming` / `tech` / `mobile` / `ai` /
`sale` and picks the emoji, colour, and which section of the board it lands in.
For anything that runs more than a day, `endDate` on a confirmed entry or
`spanDays` on a recurring rule keeps it on the board until its **last** day —
`spanDays` counts the first day, so CES's `{ "day": 6, "spanDays": 4 }` is 6–9
Jan. Preview the result with:

```bash
npm run preview:showcases          # add --no-feeds for the curated file alone
```

> The calendar and filter buttons work out of the box; they need **no extra Discord intents** (button clicks are delivered regardless).

### 4. Install & configure

```bash
cd C:\Users\aqil2\projects\discord-release-radar
copy .env.example .env
# edit .env with notepad — fill DISCORD_TOKEN, DISCORD_CHANNEL_ID, TMDB_API_KEY
npm install
npm run preview   # print the digest to your terminal — no Discord, nothing posted
npm run preview:showcases   # same, for the Showcase Radar board + countdowns
npm start         # run the bot for real (connects + posts on schedule)
```

> **Node 20+** required (better-sqlite3 ships prebuilt binaries — no compiler needed
> on Node 20/22/24). `npm run preview` is the safe way to see output on your PC
> before pointing it at your server.

`.env` essentials:

```env
DISCORD_TOKEN=...
DISCORD_CHANNEL_ID=...
TMDB_API_KEY=...
PRIMARY_REGION=MY
FALLBACK_REGIONS=SG,US,JP,GB,ID,TH,PH
TIMEZONE=Asia/Kuala_Lumpur
DIGEST_CRON=0 9 * * *
POST_WEEKLY_SUMMARY=true
```

---

## Deploy on DigitalOcean (Ubuntu 24.04)

After you push to GitHub:

```bash
# on the droplet
sudo apt update
sudo apt install -y git curl build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# install pm2
sudo npm install -g pm2

git clone https://github.com/YOUR_USER/discord-release-radar.git
cd discord-release-radar
npm install --omit=dev

nano .env   # paste production secrets
mkdir -p data

# On this server we use systemd (user lonelyslack), not pm2:
# systemctl --user enable --now release-radar.service
```

Useful on this droplet:

```bash
systemctl --user status release-radar
tail -f ~/logs/release-radar.log
ls ~/logs/release-radar-weekly/
systemctl --user restart release-radar
```

**Security:** never commit `.env`. Prefer a firewall that only allows SSH. The bot only **outbound** HTTPS to Discord / AniList / AnimeSchedule / TMDB — no inbound ports required.

---

## Project layout

```
discord-release-radar/
├── config/services.json   # your streaming add-ons
├── config/showcases.json  # showcase calendar: confirmed dates + annual rhythm
├── data/                  # SQLite (gitignored)
├── src/
│   ├── index.js           # bot entry
│   ├── config.js
│   ├── db.js
│   ├── notifier.js        # Discord embeds
│   ├── showcaseNotifier.js # the showcase board + countdown alert messages
│   ├── showcaseStore.js   # remembers feed-discovered showcases (feeds are shallow)
│   ├── scheduler.js       # cron poll loop
│   ├── interactions.js    # calendar + filter buttons → re-render in place
│   ├── digestStore.js     # remembers posted digests so buttons can re-render
│   ├── providers/
│   │   ├── anime.js       # dispatcher: AniList, falling back to AnimeSchedule
│   │   ├── anilist.js     # anime airing schedule (per day, JP names)
│   │   ├── animeschedule.js # key-free anime fallback when AniList is down
│   │   ├── tmdb.js        # TV per day, streaming arrivals, cinema, watch regions
│   │   ├── games.js       # dispatcher: picks steam (no key) or rawg
│   │   ├── steam.js       # game releases via Steam public API (no key)
│   │   ├── rawg.js        # game releases (optional RAWG key)
│   │   ├── epic.js        # Epic giveaways: free now + free next (no key)
│   │   ├── gamepass.js    # Game Pass additions, by diffing the catalog (no key)
│   │   ├── psplus.js      # PS Plus monthly announcement, via the blog feed
│   │   ├── showcases.js   # showcase calendar: confirmed + recurring, countdowns
│   │   └── showcaseFeeds.js # newly announced showcases from official feeds
│   └── utils/matchServices.js
├── .env.example
└── package.json
```

---

## Notes / limits (honest)

1. **Crunchyroll / Netflix / Disney+ have no official public “new drop” API** we can legally lean on long-term — Crunchyroll in particular has no public API to get a key for, which is why the anime sources are AniList and AnimeSchedule rather than Crunchyroll itself. We use **AniList (→ AnimeSchedule) + TMDB (+ JustWatch data via TMDB watch providers)**.
2. **Regional catalogs differ.** A Netflix MY title list ≠ Netflix US. That’s why embeds show **MY first**, then **other countries** where your brands carry it.
3. **Anime** has the best “30 minutes before” timing. **Movies/TV** usually only have a **date**, not a precise clock — we notify when the data appears.
4. Niche apps (Astro GO+, Sun NXT Lite, beIN) may have **incomplete** TMDB provider mapping — edit `config/services.json` match strings over time.
5. Keep the droplet light: default poll is every **10 minutes**, capped TMDB pages, SQLite on disk.
6. **Game Pass and Epic run on undocumented endpoints.** They're the same ones the storefronts themselves call, they need no key, and they can change without notice. Each section fails independently — if one breaks, the rest of the digest still posts.
7. **Showcase dates are only as good as the announcement.** Nobody publishes a
   feed of future showcases, so anything not yet announced is shown as the
   yearly pattern with a `~` and never triggers an alert. Verify a date you add
   by hand — the board will state it as fact.
8. **PS Plus is an announcement, not a catalog.** Sony publishes no Plus API, so that section links the monthly post rather than listing its games.

---

## Troubleshooting

### `npm install` fails building `better-sqlite3` (`gyp ERR!`, "Could not find any Visual Studio installation")

This means your **Node version is newer than the prebuilt binaries** shipped by the
installed `better-sqlite3`, so npm falls back to compiling from source (which needs
build tools you may not have — Visual Studio on Windows, `build-essential` on Linux).

**Fix — bump `better-sqlite3` to a version that has a prebuilt binary for your Node:**

```bash
node -v                              # note your Node major version (e.g. v24)
npm install better-sqlite3@latest    # pulls the newest release + its prebuilt binaries
npm install                          # reinstall the rest
```

Then verify it loads without a compiler:

```bash
node -e "new (require('better-sqlite3'))(':memory:'); console.log('sqlite OK')"
```

If `@latest` still compiles, either wait for a release that supports your Node, or
drop to an **LTS Node** (e.g. 20 or 22) which prebuilts always cover — e.g. with
`nvm install 22 && nvm use 22`.

> History: this project was originally pinned to `better-sqlite3@^11`, which had no
> Node 24 binary. Bumping to `^13` fixed it. The same move fixes the next Node jump.

### Games section is empty / low quality

- **Empty:** with `GAME_SOURCE=rawg` but no `RAWG_API_KEY`, it falls back to Steam;
  if Steam is unreachable you'll see it logged. Check network/logs.
- **Low quality (shovelware):** the keyless Steam source only sees Steam's front-page
  lists (PC only). For cleaner, cross-platform results add a free `RAWG_API_KEY`.

### Calendar / filter buttons say "this digest expired"

The buttons hold their data **in memory**, so a bot restart clears older digests'
buttons. This is expected — the **next** posted digest's buttons work normally.

### Nothing posts, no errors

Check that `DISCORD_CHANNEL_ID` is a **text channel** the bot can see and send to
(needs `View Channel`, `Send Messages`, `Embed Links`), and that a digest for the
current slot wasn't already sent (dedupe is per `YYYY-MM-DD:slot`). Use
`npm run preview` to confirm the data pipeline independently of Discord.

---

## License

MIT — use it, fork it, break it, fix it.
