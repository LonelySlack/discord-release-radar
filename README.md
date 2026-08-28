# Discord Release Radar

Lightweight **Node.js** Discord bot that posts **one daily digest** into **`#releases`**:

- 📅 **Calendar row at the top** — tap **⬅️ yesterday · 📍 today · ➡️ tomorrow** (each button shows its real date) to move the whole board between the three days
- 🎌 **Anime** airing on the selected day (AniList schedule, local MY times) — shows both the English **and** Japanese/native title, e.g. `Frieren 「葬送のフリーレン」`
- 🎬 **New on your services** — recent films that are actually streaming on your Netflix / Disney+ / Prime / HBO Max / Viu right now (TMDB), newest first
- 📺 **TV** airing on the selected day, on your services (TMDB)
- 🎟️ **Coming to cinemas** — upcoming theatrical releases in your region (TMDB), e.g. *Spider-Man: Brand New Day*
- 🎮 **Game releases** — recent + upcoming games. Works with **no API key** via Steam's public storefront (PC titles); add an optional free RAWG key for cross-platform coverage
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

AniList needs **no key**.

### 3b. Games source (no key needed)

The **Games** section works out of the box with **no key** using Steam's public
storefront API (PC titles only). Nothing to configure.

Want cross-platform coverage (consoles too) with cleaner curation? Get a free
key at [rawg.io](https://rawg.io/apidocs) and set `RAWG_API_KEY=...` in `.env` —
the bot auto-switches to RAWG when a key is present. Force a source explicitly
with `GAME_SOURCE=steam` or `GAME_SOURCE=rawg`.

> The calendar and filter buttons work out of the box; they need **no extra Discord intents** (button clicks are delivered regardless).

### 4. Install & configure

```bash
cd C:\Users\aqil2\projects\discord-release-radar
copy .env.example .env
# edit .env with notepad — fill DISCORD_TOKEN, DISCORD_CHANNEL_ID, TMDB_API_KEY
npm install
npm run preview   # print the digest to your terminal — no Discord, nothing posted
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

**Security:** never commit `.env`. Prefer a firewall that only allows SSH. The bot only **outbound** HTTPS to Discord / AniList / TMDB — no inbound ports required.

---

## Project layout

```
discord-release-radar/
├── config/services.json   # your streaming add-ons
├── data/                  # SQLite (gitignored)
├── src/
│   ├── index.js           # bot entry
│   ├── config.js
│   ├── db.js
│   ├── notifier.js        # Discord embeds
│   ├── scheduler.js       # cron poll loop
│   ├── interactions.js    # calendar + filter buttons → re-render in place
│   ├── digestStore.js     # remembers posted digests so buttons can re-render
│   ├── providers/
│   │   ├── anilist.js     # anime airing schedule (per day, JP names)
│   │   ├── tmdb.js        # TV per day, streaming arrivals, cinema, watch regions
│   │   ├── games.js       # dispatcher: picks steam (no key) or rawg
│   │   ├── steam.js       # game releases via Steam public API (no key)
│   │   └── rawg.js        # game releases (optional RAWG key)
│   └── utils/matchServices.js
├── .env.example
└── package.json
```

---

## Notes / limits (honest)

1. **Crunchyroll / Netflix / Disney+ have no official public “new drop” API** we can legally lean on long-term. We use **AniList + TMDB (+ JustWatch data via TMDB watch providers)**.
2. **Regional catalogs differ.** A Netflix MY title list ≠ Netflix US. That’s why embeds show **MY first**, then **other countries** where your brands carry it.
3. **Anime** has the best “30 minutes before” timing. **Movies/TV** usually only have a **date**, not a precise clock — we notify when the data appears.
4. Niche apps (Astro GO+, Sun NXT Lite, beIN) may have **incomplete** TMDB provider mapping — edit `config/services.json` match strings over time.
5. Keep the droplet light: default poll is every **10 minutes**, capped TMDB pages, SQLite on disk.

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
