# Discord Release Radar

Lightweight **Node.js** Discord bot that posts **one daily digest** into **`#releases`**:

- 🎌 **Anime** airing **today** (AniList schedule, local MY times)
- 🎬 **Movies** released today / recent on your streaming services (TMDB)
- 📺 **TV** airing today on your services (TMDB)

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

### 4. Install & configure

```bash
cd C:\Users\aqil2\projects\discord-release-radar
copy .env.example .env
# edit .env with notepad — fill DISCORD_TOKEN, DISCORD_CHANNEL_ID, TMDB_API_KEY
npm install
npm start
```

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
│   ├── providers/
│   │   ├── anilist.js     # anime airing schedule
│   │   └── tmdb.js        # movies + TV + watch regions
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

## License

MIT — use it, fork it, break it, fix it.
