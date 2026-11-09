# EuroLeague PIR Tracker

Reconstructs the **Performance Index Rating (PIR) of every EuroLeague player at every moment of every game**, historical and live, from the official play-by-play feed. Pick a season, a game, a player and any second of the game, and the app shows the exact cumulative PIR at that moment, plus the events that moved it.

```
FastAPI + PostgreSQL backend   ←  EuroLeague public feeds (live.euroleague.net, api-live.euroleague.net)
  ├─ app/pir_engine.py           one PIR engine for historical and live games
  ├─ app/importer.py             seasons, schedules, game import, box-score validation
  ├─ app/worker.py               schedule sync · live polling (10 s) · historical backfill
  └─ app/api.py                  REST API (timelines, PIR-at-time, search, profiles, live)
Next.js 15 + React 19 + Recharts frontend
  Dashboard | Live Games | Historical Games | Players | Advanced PIR Search
```

## Quick start

### Docker (everything)

```bash
docker compose up --build
# web  → http://localhost:3000
# api  → http://localhost:8000/docs
```

The `worker` service syncs seasons and schedules. It then backfills every season that has play-by-play (2007-08 onwards, newest first) and polls live games. At the polite default of one request per second, a full backfill takes about 4 hours. The current season is imported within minutes.

### Local development

```bash
# PostgreSQL (any 13+). Default URL: postgresql+psycopg://postgres@127.0.0.1:5432/pir
createdb pir

cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m app.cli import-game E2025 1        # one game, validated against the box score
python -m app.cli import-season E2026        # a whole season
python -m app.cli worker                     # schedule sync + live polling + backfill
uvicorn app.api:app --port 8000              # API

cd ../frontend
npm install
BACKEND_URL=http://127.0.0.1:8000 npm run dev   # http://localhost:3000
```

Other CLI commands: `seasons`, `schedule <season>`, `backfill [--from-year 2015]`, `reimport [season]` (re-fetches and re-processes already imported games, e.g. after an engine change).

### Credentials and configuration

**No API key is required.** The feeds are public, unauthenticated JSON endpoints. They do reject requests without a browser-like `User-Agent`, which the client sets. All settings are environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://postgres@127.0.0.1:5432/pir` | SQLAlchemy URL (PostgreSQL; SQLite works for tests) |
| `EL_REQUEST_INTERVAL` | `1.0` | Seconds between feed requests during imports |
| `EL_LIVE_POLL_INTERVAL` | `10` | Live play-by-play polling cadence (s) |
| `EL_SCHEDULE_REFRESH_INTERVAL` | `300` | Schedule refresh / live-game detection (s) |
| `EL_LIVE_STALE_AFTER` | `45` | A live game with no successful update for this long is shown as **Delayed** |
| `EL_BACKFILL` / `EL_BACKFILL_FROM_YEAR` | `1` / `2007` | Worker's one-off historical import |
| `EL_COMPETITION` | `E` | `E` = EuroLeague (`U` = EuroCup uses the same feeds) |
| `BACKEND_URL` (frontend) | `http://127.0.0.1:8000` | Where Next.js proxies `/api/*` (resolved at build time) |

## Data source

Every endpoint below was tested against the live service before being used:

| Endpoint | Used for |
|---|---|
| `GET https://api-live.euroleague.net/v2/competitions/E/seasons` | Season list (E2000 … current) |
| `GET https://api-live.euroleague.net/v2/competitions/E/seasons/{season}/games` | Schedule, scores, played flag, teams, crests |
| `GET https://live.euroleague.net/api/PlayByPlay?gamecode={n}&seasoncode={season}` | Play-by-play, including the `Live` flag |
| `GET https://live.euroleague.net/api/Boxscore?gamecode={n}&seasoncode={season}` | Roster, minutes and the official PIR (`Valuation`) used for validation |
| `GET https://live.euroleague.net/api/Header?gamecode={n}&seasoncode={season}` | Game header (score, quarter, clock) |

Findings:

* **Coverage.** Schedules go back to 2000-01, but play-by-play and box scores exist only from **2007-08**. For earlier seasons the feed answers HTTP 200 with an empty body, which is recorded as `no_data`, never as an empty game.
* **Rate limits.** The feed is behind Cloudflare and answered **HTTP 429** at roughly 170 requests/minute. Imports therefore run at 1 request/second, and 429s back off for 15 s, 30 s, 60 s and so on. Live polling fetches play-by-play every 10 s per live game, plus the box score at most once a minute.
* **Usage rights.** No published terms of use for these endpoints could be found or verified, and euroleaguebasketball.net was not reachable from the build environment. They are the unauthenticated feeds behind EuroLeague's own websites. The data is EuroLeague's property, so **check Euroleague Basketball's terms before any public or commercial deployment**. Keep the polite request rate.
* **Errors.** Network failures, 5xx responses and malformed JSON are retried and then stored on the game (`last_error`) and shown in the UI. Nothing is ever fabricated. Postponed or cancelled games are flagged from the schedule's `gameStatus`.

## PIR engine

`PIR = PTS + REB + AST + STL + BLK + Fouls drawn − missed FG − missed FT − TO − shots blocked against − fouls committed`

Each play-by-play row is one statistical action by one player (a basket and its assist are separate rows), so mapping each play type to one delta can't double-count:

| +2 | +3 | +1 | −1 |
|---|---|---|---|
| `2FGM`, `DUNK`, `LAYUPMD` | `3FGM` | `FTM`, `O`, `D`, `AS`, `ST`, `FV` (block), `RV` (foul drawn) | `2FGA`, `3FGA`, `2FGAB`, `3FGAB`, `LAYUPATT`, `FTA`, `TO`, `AG` (blocked against), `OF` and every `CM*` foul (`CM`, `CMU`, `CMT`, `CMD`, `CMT1`, `CMU_DI`, `CMU_FL`, …) |

Rows with no player (team rebounds and similar) and coach/bench pseudo-IDs (`CO_A`, `CO_B`, `AC_*`) never affect a player.

**Time.** Events are processed in the feed's array order, which is the official chronological sequence (`NUMBEROFPLAY` is an entry ID and is *not* chronological). Ties at the same clock keep that order. Elapsed seconds = period start + (period length − remaining clock), with 10-minute quarters and 5-minute overtimes, so `12:00` elapsed means Q2 08:00. Scorer clock typos are repaired, and every repair is recorded in the game's "Data notes":

1. A group stamped exactly one minute early (`09:00` for `08:00`, a systematic quirk in 2010–2016 feeds, or a minute-digit typo) is shifted +60 s when that puts it between its neighbours.
2. A group stamped far *ahead* of both neighbours is snapped back to its predecessor.
3. Anything still earlier than its predecessor is pinned to it, so elapsed time is monotonic.
4. Overtimes whose "Begin Period" row is missing are still split correctly.

Clock repairs only move *when* an event is drawn on the timeline. They never change the PIR totals.

**Validation.** After every import, each player's reconstructed final PIR is compared with the official box-score `Valuation`. Team points are also checked against the box-score totals. Each game gets `ok` (✓ Box score verified), `mismatch` (with per-component diffs, e.g. fouls 2 vs 1), `incomplete` (no End Game marker) or `no_boxscore`. In development, 195 games sampled across 2007-08 to 2026-27 matched the official PIR for every player once all the play-type codes above were handled. The few mismatches seen in full-season imports are genuine feed inconsistencies. For example, in E2026 game 97 the play-by-play logs a flagrant foul as a player's second foul, while the box score lists only one. Those games are flagged in the UI.

**Storage.** Per game: `events` (every row with seq, period, clock and elapsed seconds), `pir_timeline` (cumulative PIR after every PIR-changing event per player), `pir_minutes` (PIR at each minute 0–40+OT, materialised for fast search) and `game_players` (final, official, peak, low and largest drop). Re-importing a game replaces its rows in one transaction under a per-game advisory lock, so data is never duplicated and late feed corrections are picked up.

## API

Interactive docs are at `/docs`. Main routes:

* `GET /api/games/{id}/pir-at?t=725` (or `minute=12`, `quarter=3` for end of Q3): every player's PIR at that moment.
* `GET /api/games/{id}/timeline?players=P007200,P006835`: step series with the play that caused each change.
* `GET /api/search/at-time?minute=12&min_pir=20&season=E2026&team=OLY&opponent=PAN&date_from=…`
* `GET /api/search/reached?threshold=25&before_quarter_end=2`: reached PIR 25 before halftime.
* `GET /api/search/drops?min_drop=10`: PIR fell by 10 or more from an in-game peak.
* `GET /api/players/{id}`: profile with PIR at minutes 5…40 per game and stage averages.
* `GET /api/players/{id}/at-time?minute=10&last=20`: a player's PIR at minute 10 over their last 20 games.
* `GET /api/live`, `GET /api/status`, `GET /api/seasons`, `GET /api/games`, `GET /api/players`, `GET /api/teams`

Search accepts any second (`t=`). Whole minutes use the materialised `pir_minutes` table, and other seconds query `pir_timeline` through the `(game, player, elapsed, seq)` indexes.

## Live games

The worker refreshes the current season's schedule every 5 minutes. From 20 minutes before a scheduled tip-off until 3.5 hours after it, and for any game already marked live, it polls play-by-play every 10 s. It re-runs the same engine and stores the result. Once the feed drops `Live` and shows *End Game*, the game is finalised and validated against the box score. A game whose validation failed because the box score lagged is re-checked over the next 3 days.

The Live Games page refreshes every 5 s. It shows the score, quarter and clock, every player's current PIR and the live timeline, which follows the latest event unless you move the slider. It also shows the last successful update, a **Delayed** badge when updates stop, and a warning when the worker itself is not running.

## Tests

```bash
cd backend && pytest -q
```

The tests cover:

* Every formula component, negative PIR and the new and legacy play-type codes.
* Overtimes with and without "Begin Period" rows, clock-typo repairs, and ordering of identical timestamps.
* Real recorded games: E2025 game 1, plus E2010 game 12, a double-overtime game.
* An end-to-end import through the HTTP API on SQLite, including idempotent re-imports.
* A live import of a recorded first half, which must give exactly the same half-time PIR as the final reconstruction.

## Known limitations

* No game was live while this was built (the next ones tip off on 11 Nov 2026), so the live path is verified by replaying a recorded game rather than a real broadcast.
* Team crests are hot-linked from EuroLeague's CDN and are hidden if they fail to load.
* Play-by-play is unavailable before 2007-08, and those seasons show schedules only.
