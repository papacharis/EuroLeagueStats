"""Import seasons, schedules and games into the database.

Historical imports and live updates both go through `import_game`, which
re-reconstructs the whole game from the full play-by-play payload and
replaces the game's rows atomically.  Re-running is idempotent: no duplicate
events or games can be produced, and late corrections in the feed are picked
up automatically.
"""

from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, delete, or_, select, text, update

from . import config
from .db import (
    events,
    game_players,
    games,
    get_engine,
    pir_minutes,
    pir_timeline,
    players,
    seasons,
    sync_state,
    upsert,
)
from .euroleague_client import EuroLeagueClient, NoData, SourceError
from .pir_engine import (
    GameReconstruction,
    box_pir,
    box_score_players,
    game_clock_for_elapsed,
    reconstruct,
    validate_against_box_score,
)

log = logging.getLogger(__name__)

LIVE_BOX_REFRESH = 60.0  # seconds
_live_box_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _strip_nul(v: Any) -> Any:
    if isinstance(v, str):
        return v.replace("\x00", "")
    if isinstance(v, dict):
        return {k: _strip_nul(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_strip_nul(x) for x in v]
    return v


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def game_id(season: str, code: int) -> str:
    return f"{season}_{code}"


def _parse_dt(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def set_state(conn, key: str, value: Any) -> None:
    upsert(conn, sync_state, [{"key": key, "value": value, "updated_at": utcnow()}], ["key"])


# ------------------------------------------------------------------ seasons

def sync_seasons(client: EuroLeagueClient) -> list[str]:
    data = client.seasons()
    rows = []
    for s in data:
        year = s.get("year")
        if year is None or year < config.FIRST_PBP_SEASON_YEAR:
            continue
        rows.append({
            "code": s["code"],
            "name": s.get("name"),
            "alias": s.get("alias"),
            "year": year,
            "start_date": _parse_dt(s.get("startDate")),
            "end_date": _parse_dt(s.get("endDate")),
            "pbp_supported": True,
        })
    with get_engine().begin() as conn:
        upsert(conn, seasons, rows, ["code"])
        set_state(conn, "seasons_synced", {"at": utcnow().isoformat(), "count": len(rows)})
    return [r["code"] for r in sorted(rows, key=lambda r: -r["year"])]


def current_season_code() -> str | None:
    now = utcnow()
    with get_engine().connect() as conn:
        rows = conn.execute(select(seasons).order_by(seasons.c.year.desc())).mappings().all()
    for r in rows:
        start, end = r["start_date"], r["end_date"]
        if start and end:
            start = start if start.tzinfo else start.replace(tzinfo=timezone.utc)
            end = end if end.tzinfo else end.replace(tzinfo=timezone.utc)
            if start <= now <= end:
                return r["code"]
    return rows[0]["code"] if rows else None


# ----------------------------------------------------------------- schedule

def _schedule_status(g: dict[str, Any]) -> str:
    src = (g.get("gameStatus") or "").lower()
    if "postpon" in src or "cancel" in src or "suspend" in src:
        return "postponed"
    return "final" if g.get("played") else "scheduled"


def sync_schedule(client: EuroLeagueClient, season: str) -> int:
    data = client.games(season)
    with get_engine().begin() as conn:
        existing = {
            r.id: r for r in conn.execute(
                select(games.c.id, games.c.status, games.c.pbp_imported_at).where(games.c.season_code == season)
            )
        }
        rows = []
        for g in data:
            code = g.get("gameCode")
            if code is None:
                continue
            gid = game_id(season, code)
            sched_status = _schedule_status(g)
            prev = existing.get(gid)
            status = sched_status
            force_reimport = False
            if prev is not None and prev.status == "live":
                if sched_status == "scheduled":
                    status = "live"  # never downgrade a game the live poller marked live
                elif sched_status == "final":
                    force_reimport = True  # make sure the final payload gets imported
            if prev is not None and prev.status == "no_data" and sched_status == "final":
                status = "no_data"
            local, road = g.get("local") or {}, g.get("road") or {}
            lc, rc = local.get("club") or {}, road.get("club") or {}
            rows.append({
                "id": gid,
                "season_code": season,
                "game_code": code,
                "round": g.get("round"),
                "round_name": g.get("roundName") or g.get("roundAlias"),
                "phase": (g.get("phaseType") or {}).get("name"),
                "utc_date": _parse_dt(g.get("utcDate")) or _parse_dt(g.get("date")),
                "home_code": lc.get("code"),
                "home_name": lc.get("name"),
                "home_crest": (lc.get("images") or {}).get("crest"),
                "away_code": rc.get("code"),
                "away_name": rc.get("name"),
                "away_crest": (rc.get("images") or {}).get("crest"),
                "home_score": local.get("score") if g.get("played") or status == "live" else None,
                "away_score": road.get("score") if g.get("played") or status == "live" else None,
                "source_status": g.get("gameStatus"),
                "played": bool(g.get("played")),
                "status": status,
                **({"pbp_imported_at": None} if force_reimport else {}),
            })
        # Live scores are owned by the live poller.
        live_rows = [r for r in rows if r["status"] == "live"]
        for r in live_rows:
            r.pop("home_score")
            r.pop("away_score")
        # Rows must share the same columns for a multi-row upsert.
        for r in rows:
            if r["status"] != "live":
                upsert(conn, games, [r], ["id"])
        for r in live_rows:
            upsert(conn, games, [r], ["id"])
        conn.execute(
            update(seasons).where(seasons.c.code == season).values(
                games_total=len(rows), schedule_synced_at=utcnow()
            )
        )
    return len(rows)


# ------------------------------------------------------------------- games

def _team_points_check(rec: GameReconstruction, box: dict[str, Any]) -> list[str]:
    issues = []
    rec_pts: dict[str, int] = {}
    for p in rec.players.values():
        rec_pts[p.team_code or ""] = rec_pts.get(p.team_code or "", 0) + p.box_like()["points"]
    for team in box.get("Stats") or []:
        ps = team.get("PlayersStats") or []
        code = next(((x.get("Team") or "").strip() for x in ps if (x.get("Team") or "").strip()), None)
        total = (team.get("totr") or {}).get("Points")
        if code and total is not None and rec_pts.get(code, 0) != total:
            issues.append(f"{code}: play-by-play points {rec_pts.get(code, 0)} vs box score {total}")
    return issues


def _minutes_played(v: Any) -> bool:
    s = (str(v) if v is not None else "").strip().upper()
    return bool(s) and s not in ("DNP", "0:00", "00:00")


def import_game(client: EuroLeagueClient, season: str, code: int, *, live_mode: bool = False) -> dict[str, Any]:
    """Fetch play-by-play + box score, reconstruct PIR, store atomically.

    Returns a small summary dict.  Raises SourceError on hard failures (the
    error is also recorded on the game row)."""
    gid = game_id(season, code)
    now = utcnow()
    try:
        pbp = client.play_by_play(season, code)
    except NoData as exc:
        with get_engine().begin() as conn:
            conn.execute(update(games).where(games.c.id == gid).values(
                last_attempt_at=now, last_error=f"No play-by-play available: {exc}",
                **({} if live_mode else {"status": "no_data", "validation_status": "incomplete"}),
            ))
        raise
    except SourceError as exc:
        with get_engine().begin() as conn:
            conn.execute(update(games).where(games.c.id == gid).values(last_attempt_at=now, last_error=str(exc)))
        raise

    pbp = _strip_nul(pbp)
    rec = reconstruct(pbp)

    # The box score supplies the roster (incl. starters with no event yet) and
    # the official PIR used for validation.  While a game is live it is only
    # refreshed once a minute to keep request volume low.
    box: dict[str, Any] = {}
    box_error = None
    cached = _live_box_cache.get(gid)
    if rec.is_live and cached and time.monotonic() - cached[0] < LIVE_BOX_REFRESH:
        box = cached[1]
    else:
        try:
            box = _strip_nul(client.box_score(season, code))
            if rec.is_live:
                _live_box_cache[gid] = (time.monotonic(), box)
            else:
                _live_box_cache.pop(gid, None)
        except SourceError as exc:
            box_error = str(exc)
            if cached:
                box = cached[1]
    is_live = rec.is_live
    has_end = any(e.play_type == "EG" for e in rec.events)
    max_elapsed = max((e.elapsed_seconds for e in rec.events), default=0)

    warnings = list(rec.warnings)
    if box_error:
        warnings.append(f"Box score unavailable: {box_error}")
    if is_live:
        validation = {"status": "live", "mismatches": [], "checked": 0}
        vstatus = "live"
    else:
        validation = validate_against_box_score(rec, box) if box else {"status": "no_boxscore", "mismatches": [], "checked": 0}
        if box:
            pts_issues = _team_points_check(rec, box)
            if pts_issues:
                warnings.extend(pts_issues)
                validation["points_issues"] = pts_issues
        vstatus = validation["status"]
        if vstatus == "ok" and (not has_end or not rec.events):
            vstatus = "incomplete"
        if vstatus == "ok" and validation.get("points_issues"):
            vstatus = "mismatch"
    mismatch_ids = {m["player_id"] for m in validation.get("mismatches", [])}

    # ---- participants: official box score first, then anyone in the PBP.
    box_players = {(p.get("Player_ID") or "").strip(): p for p in box_score_players(box)} if box else {}
    with get_engine().connect() as conn:
        grow = conn.execute(select(games).where(games.c.id == gid)).mappings().first()
    home_code = (grow or {}).get("home_code") or (pbp.get("CodeTeamA") or "").strip()
    away_code = (grow or {}).get("away_code") or (pbp.get("CodeTeamB") or "").strip()
    game_date = (grow or {}).get("utc_date")

    def opponent(team: str | None) -> str | None:
        if team == home_code:
            return away_code
        if team == away_code:
            return home_code
        return None

    gp_rows, player_rows, minute_rows, timeline_rows = [], [], [], []
    all_ids = list(dict.fromkeys(list(box_players.keys()) + list(rec.players.keys())))
    last_minute = math.ceil(max_elapsed / 60) if max_elapsed else 0
    for pid in all_ids:
        bp = box_players.get(pid)
        pr = rec.players.get(pid)
        team = ((bp or {}).get("Team") or "").strip() or (pr.team_code if pr else None)
        summary = pr.summary() if pr else {
            "final_pir": 0, "max_pir": 0, "max_pir_elapsed": 0,
            "min_pir": 0, "min_pir_elapsed": 0, "max_drop": 0,
        }
        name = ((bp or {}).get("Player") or "").strip() or (pr.player_name if pr else None) or pid
        played = _minutes_played((bp or {}).get("Minutes")) if bp else True
        if pr and pr.timeline:
            played = True
        official = box_pir(bp) if bp else None
        gp_rows.append({
            "game_id": gid,
            "player_id": pid,
            "team_code": team,
            "opponent_code": opponent(team),
            "dorsal": ((bp or {}).get("Dorsal") or (pr.dorsal if pr else None) or None),
            "is_starter": bool((bp or {}).get("IsStarter")),
            "minutes": (bp or {}).get("Minutes"),
            "played": played,
            "box": bp,
            "official_pir": official,
            "validated": None if is_live or official is None else (pid not in mismatch_ids),
            **summary,
        })
        player_rows.append({"id": pid, "name": name})
        if pr:
            for t in pr.timeline:
                timeline_rows.append({
                    "game_id": gid, "player_id": pid, "seq": t.seq,
                    "elapsed_seconds": t.elapsed_seconds, "period": t.period,
                    "marker_time": t.marker_time, "play_type": t.play_type,
                    "play_info": t.play_info[:128], "delta": t.delta, "pir": t.pir,
                })
        if played:
            idx, cur = 0, 0
            tl = pr.timeline if pr else []
            for m in range(0, last_minute + 1):
                while idx < len(tl) and tl[idx].elapsed_seconds <= m * 60:
                    cur = tl[idx].pir
                    idx += 1
                minute_rows.append({"game_id": gid, "player_id": pid, "minute": m, "pir": cur})

    event_rows = [{
        "game_id": gid, "seq": e.seq, "number_of_play": e.number_of_play, "period": e.period,
        "marker_time": e.marker_time, "elapsed_seconds": e.elapsed_seconds, "play_type": e.play_type,
        "play_info": e.play_info[:128], "player_id": e.player_id, "team_code": e.team_code,
        "points_a": e.points_a, "points_b": e.points_b, "pir_delta": e.pir_delta,
    } for e in rec.events]

    # Scores straight from the feed (authoritative while live).
    score_a = max((e.points_a for e in rec.events if e.points_a is not None), default=0)
    score_b = max((e.points_b for e in rec.events if e.points_b is not None), default=0)
    cur_period, cur_clock = (None, None)
    if rec.events:
        cur_period, cur_clock = game_clock_for_elapsed(max_elapsed)
        cur_period = max(cur_period, rec.max_period) if not has_end else rec.max_period

    if is_live:
        status = "live"
    elif not rec.events:
        status = "scheduled" if live_mode else "no_data"
    elif has_end or not live_mode:
        status = "final"
    else:
        # Feed not flagged live, no End Game marker yet: keep polling.
        status = "live"

    game_update = {
        "status": status,
        "num_events": len(rec.events),
        "max_period": rec.max_period,
        "current_period": cur_period,
        "current_clock": "00:00" if has_end else cur_clock,
        "pbp_imported_at": now,
        "last_attempt_at": now,
        "last_error": None,
        "validation_status": vstatus,
        "validation": validation,
        "warnings": warnings,
    }
    if live_mode or is_live:
        game_update["last_live_update"] = now
    if rec.events:
        a_code = (pbp.get("CodeTeamA") or "").strip()
        if a_code and a_code == away_code:
            score_a, score_b = score_b, score_a
        game_update["home_score"], game_update["away_score"] = score_a, score_b

    with get_engine().begin() as conn:
        # Serialise concurrent writers of the same game (backfill, schedule
        # loop and live poller may overlap) for the duration of this transaction.
        if conn.engine.dialect.name == "postgresql":
            conn.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": gid})
            grow = conn.execute(select(games).where(games.c.id == gid)).mappings().first()
        if grow is None:
            conn.execute(games.insert().values(
                id=gid, season_code=season, game_code=code,
                home_code=home_code, home_name=pbp.get("TeamA"),
                away_code=away_code, away_name=pbp.get("TeamB"),
            ))
        for t in (events, pir_timeline, pir_minutes, game_players):
            conn.execute(delete(t).where(t.c.game_id == gid))
        if event_rows:
            conn.execute(events.insert(), event_rows)
        if timeline_rows:
            conn.execute(pir_timeline.insert(), timeline_rows)
        if minute_rows:
            conn.execute(pir_minutes.insert(), minute_rows)
        if gp_rows:
            conn.execute(game_players.insert(), gp_rows)
        upsert(conn, players, player_rows, ["id"])
        if game_date is not None:
            for r in gp_rows:
                team = r["team_code"]
                team_name = None
                if team == home_code:
                    team_name = (grow or {}).get("home_name")
                elif team == away_code:
                    team_name = (grow or {}).get("away_name")
                conn.execute(update(players).where(and_(
                    players.c.id == r["player_id"],
                    or_(players.c.last_game_date.is_(None), players.c.last_game_date <= game_date),
                )).values(last_team_code=team, last_team_name=team_name, last_game_date=game_date))
        conn.execute(update(games).where(games.c.id == gid).values(**game_update))

    return {
        "game_id": gid,
        "status": status,
        "validation": vstatus,
        "events": len(event_rows),
        "players": len(gp_rows),
        "mismatches": len(mismatch_ids),
        "warnings": warnings,
    }


def games_needing_import(season: str) -> list[int]:
    with get_engine().connect() as conn:
        rows = conn.execute(
            select(games.c.game_code).where(
                games.c.season_code == season,
                games.c.status == "final",
                games.c.pbp_imported_at.is_(None),
            ).order_by(games.c.utc_date)
        ).all()
    return [r.game_code for r in rows]


def import_season(client: EuroLeagueClient, season: str, *, refresh_schedule: bool = True,
                  limit: int | None = None) -> dict[str, Any]:
    if refresh_schedule:
        sync_schedule(client, season)
    todo = games_needing_import(season)
    if limit:
        todo = todo[:limit]
    stats = {"season": season, "attempted": len(todo), "imported": 0, "no_data": 0, "errors": 0, "mismatch": 0}
    for code in todo:
        try:
            res = import_game(client, season, code)
            stats["imported"] += 1
            if res["validation"] == "mismatch":
                stats["mismatch"] += 1
            log.info("%s %s events=%s validation=%s", season, code, res["events"], res["validation"])
        except NoData:
            stats["no_data"] += 1
        except SourceError as exc:
            stats["errors"] += 1
            log.warning("import %s %s failed: %s", season, code, exc)
        except Exception as exc:  # bad payload / DB error: record it, keep going
            stats["errors"] += 1
            log.exception("import %s %s crashed", season, code)
            with get_engine().begin() as conn:
                conn.execute(update(games).where(games.c.id == game_id(season, code)).values(
                    last_attempt_at=utcnow(), last_error=f"Import failed: {exc!r}"[:2000]))
    with get_engine().begin() as conn:
        set_state(conn, f"season_import:{season}", {"at": utcnow().isoformat(), **stats})
    return stats


def candidate_live_games(window_before: timedelta = timedelta(minutes=20),
                         window_after: timedelta = timedelta(hours=3, minutes=30)) -> list[dict[str, Any]]:
    """Games that are live, or scheduled to have tipped off recently."""
    now = utcnow()
    with get_engine().connect() as conn:
        rows = conn.execute(
            select(games.c.id, games.c.season_code, games.c.game_code, games.c.status, games.c.utc_date).where(
                or_(
                    games.c.status == "live",
                    and_(
                        games.c.status == "scheduled",
                        games.c.utc_date <= now + window_before,
                        games.c.utc_date >= now - window_after,
                    ),
                )
            )
        ).mappings().all()
    return [dict(r) for r in rows]
