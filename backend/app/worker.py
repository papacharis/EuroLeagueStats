"""Background worker: schedule sync, historical backfill and live polling.

Three loops run in threads of one process:

* schedule loop (every EL_SCHEDULE_REFRESH_INTERVAL s): refresh the current
  season's schedule, import newly finished games, re-validate recent games
  whose box score lagged behind the play-by-play.
* live loop (every EL_LIVE_POLL_INTERVAL s): poll the play-by-play of every
  game that is live or due to tip off, re-run the PIR engine and store it.
* backfill (once, at start-up, if EL_BACKFILL=1): import every missing game
  of every season with play-by-play, newest first, politely rate limited.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import timedelta

from sqlalchemy import and_, select

from . import config
from .db import games, get_engine, init_db
from .euroleague_client import EuroLeagueClient, NoData, SourceError
from .importer import (
    candidate_live_games,
    current_season_code,
    import_game,
    import_season,
    set_state,
    sync_schedule,
    sync_seasons,
    utcnow,
)

log = logging.getLogger("worker")
stop_event = threading.Event()


def _state(key: str, value: dict) -> None:
    with get_engine().begin() as conn:
        set_state(conn, key, value)


def schedule_loop() -> None:
    client = EuroLeagueClient()
    last_seasons_sync = 0.0
    while not stop_event.is_set():
        started = utcnow()
        info: dict = {"at": started.isoformat()}
        try:
            if time.time() - last_seasons_sync > 6 * 3600:
                sync_seasons(client)
                last_seasons_sync = time.time()
            season = current_season_code()
            info["season"] = season
            if season:
                info["games_in_schedule"] = sync_schedule(client, season)
                info["import"] = import_season(client, season, refresh_schedule=False)
                info["revalidated"] = revalidate_recent(client)
            info["ok"] = True
        except SourceError as exc:
            info.update(ok=False, error=str(exc))
            log.warning("schedule loop: %s", exc)
        except Exception as exc:  # keep the worker alive
            info.update(ok=False, error=repr(exc))
            log.exception("schedule loop crashed")
        _state("schedule_loop", info)
        stop_event.wait(config.SCHEDULE_REFRESH_INTERVAL)


def revalidate_recent(client: EuroLeagueClient) -> int:
    """Re-import recently finished games whose validation was not clean
    (the official box score often lags the final buzzer by a few minutes)."""
    now = utcnow()
    with get_engine().connect() as conn:
        rows = conn.execute(
            select(games.c.season_code, games.c.game_code).where(and_(
                games.c.status == "final",
                games.c.validation_status.in_(("mismatch", "no_boxscore", "incomplete", "live")),
                games.c.utc_date >= now - timedelta(days=3),
                games.c.last_attempt_at <= now - timedelta(minutes=10),
            ))
        ).all()
    n = 0
    for season, code in rows:
        try:
            import_game(client, season, code)
            n += 1
        except SourceError as exc:
            log.warning("revalidate %s %s: %s", season, code, exc)
    return n


def live_loop() -> None:
    client = EuroLeagueClient(min_interval=0.2, retries=2)
    while not stop_event.is_set():
        cycle_start = time.monotonic()
        info: dict = {"at": utcnow().isoformat(), "games": [], "errors": []}
        try:
            for g in candidate_live_games():
                try:
                    res = import_game(client, g["season_code"], g["game_code"], live_mode=True)
                    info["games"].append({"id": g["id"], "status": res["status"], "events": res["events"]})
                except NoData:
                    pass  # not started yet
                except SourceError as exc:
                    info["errors"].append({"id": g["id"], "error": str(exc)})
                    log.warning("live poll %s failed: %s", g["id"], exc)
        except Exception as exc:
            info["errors"].append({"error": repr(exc)})
            log.exception("live loop crashed")
        _state("live_poller", info)
        elapsed = time.monotonic() - cycle_start
        stop_event.wait(max(1.0, config.LIVE_POLL_INTERVAL - elapsed))


def backfill() -> None:
    client = EuroLeagueClient()
    from_year = int(os.environ.get("EL_BACKFILL_FROM_YEAR", config.FIRST_PBP_SEASON_YEAR))
    try:
        codes = sync_seasons(client)
    except SourceError as exc:
        _state("backfill", {"ok": False, "error": str(exc), "at": utcnow().isoformat()})
        return
    done = []
    for code in codes:  # newest first
        if stop_event.is_set():
            break
        if int(code[1:]) < from_year:
            continue
        _state("backfill", {"running": True, "season": code, "done": done, "at": utcnow().isoformat()})
        try:
            done.append(import_season(client, code))
        except SourceError as exc:
            done.append({"season": code, "error": str(exc)})
    _state("backfill", {"running": False, "done": done, "at": utcnow().isoformat()})


def run_worker() -> None:
    init_db()
    threads = [
        threading.Thread(target=schedule_loop, name="schedule", daemon=True),
        threading.Thread(target=live_loop, name="live", daemon=True),
    ]
    if os.environ.get("EL_BACKFILL", "1") == "1":
        threads.append(threading.Thread(target=backfill, name="backfill", daemon=True))
    for t in threads:
        t.start()
        time.sleep(2)  # let the first schedule sync land before live polling
    log.info("worker started: %s", [t.name for t in threads])
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        stop_event.set()
