"""FastAPI application: read API over the reconstructed PIR database."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import and_, func, or_, select

from . import config
from .db import game_players, games, get_engine, init_db, pir_minutes, pir_timeline, players, seasons, sync_state
from .pir_engine import game_clock_for_elapsed, period_end_seconds
from .queries import Filters, display_name, drops, pir_at_time, player_at_time_series, reached

app = FastAPI(title="EuroLeague PIR Tracker API", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["GET"], allow_headers=["*"]
)

CHECKPOINT_MINUTES = [5, 10, 15, 20, 25, 30, 35, 40]


@app.on_event("startup")
def _startup() -> None:
    init_db()


def _iso(v: Any) -> Any:
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).isoformat()
    return v


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    return {k: _iso(v) for k, v in d.items()}


def _game_dict(r) -> dict[str, Any]:
    d = _clean(dict(r))
    d["live_stale"] = None
    if d.get("status") == "live":
        lu = r.get("last_live_update")
        if lu is None:
            d["live_stale"] = True
        else:
            lu = lu if lu.tzinfo else lu.replace(tzinfo=timezone.utc)
            d["live_stale"] = (datetime.now(timezone.utc) - lu).total_seconds() > config.LIVE_STALE_AFTER
    return d


def _parse_date(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        raise HTTPException(400, f"Invalid date: {v}")
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _time_param(t: int | None, minute: float | None, quarter: int | None) -> int:
    if t is not None:
        return t
    if minute is not None:
        return int(round(minute * 60))
    if quarter is not None:
        return period_end_seconds(quarter)
    raise HTTPException(400, "Provide t (seconds), minute, or quarter (end of quarter)")


# ------------------------------------------------------------------ status

@app.get("/api/health")
def health() -> dict[str, Any]:
    with get_engine().connect() as conn:
        conn.execute(select(1))
    return {"ok": True}


@app.get("/api/status")
def status() -> dict[str, Any]:
    with get_engine().connect() as conn:
        counts = {
            "seasons": conn.execute(select(func.count()).select_from(seasons)).scalar_one(),
            "games_total": conn.execute(select(func.count()).select_from(games)).scalar_one(),
            "games_imported": conn.execute(select(func.count()).where(games.c.pbp_imported_at.is_not(None))).scalar_one(),
            "players": conn.execute(select(func.count()).select_from(players)).scalar_one(),
            "timeline_points": conn.execute(select(func.count()).select_from(pir_timeline)).scalar_one(),
        }
        by_validation = dict(conn.execute(
            select(games.c.validation_status, func.count()).where(games.c.pbp_imported_at.is_not(None))
            .group_by(games.c.validation_status)
        ).all())
        state = {r.key: {"value": r.value, "updated_at": _iso(r.updated_at)} for r in conn.execute(select(sync_state))}
    return {"counts": counts, "validation": by_validation, "sync": state, "now": datetime.now(timezone.utc).isoformat()}


# ------------------------------------------------------------------ seasons / games

@app.get("/api/seasons")
def list_seasons() -> list[dict[str, Any]]:
    with get_engine().connect() as conn:
        imported = dict(conn.execute(
            select(games.c.season_code, func.count()).where(games.c.pbp_imported_at.is_not(None)).group_by(games.c.season_code)
        ).all())
        played = dict(conn.execute(
            select(games.c.season_code, func.count()).where(games.c.status.in_(("final", "live", "no_data"))).group_by(games.c.season_code)
        ).all())
        rows = conn.execute(select(seasons).order_by(seasons.c.year.desc())).mappings().all()
    return [{**_clean(dict(r)), "games_imported": imported.get(r["code"], 0), "games_played": played.get(r["code"], 0)} for r in rows]


@app.get("/api/games")
def list_games(
    season: str | None = None,
    team: str | None = None,
    status: str | None = None,
    q: str | None = None,
    imported: bool | None = None,
    limit: int = Query(100, le=1000),
    offset: int = 0,
    order: str = "desc",
) -> dict[str, Any]:
    conds = []
    if season:
        conds.append(games.c.season_code == season)
    if team:
        conds.append(or_(games.c.home_code == team.upper(), games.c.away_code == team.upper()))
    if status:
        conds.append(games.c.status.in_(status.split(",")))
    if q:
        like = f"%{q}%"
        conds.append(or_(games.c.home_name.ilike(like), games.c.away_name.ilike(like),
                         games.c.home_code.ilike(like), games.c.away_code.ilike(like)))
    if imported is not None:
        conds.append(games.c.pbp_imported_at.is_not(None) if imported else games.c.pbp_imported_at.is_(None))
    cols = [c for c in games.c if c.name not in ("validation", "warnings")]
    base = select(*cols).where(and_(*conds)) if conds else select(*cols)
    with get_engine().connect() as conn:
        total = conn.execute(select(func.count()).select_from(base.subquery())).scalar_one()
        ordering = games.c.utc_date.desc() if order == "desc" else games.c.utc_date.asc()
        rows = conn.execute(base.order_by(ordering, games.c.game_code.desc()).limit(limit).offset(offset)).mappings().all()
    return {"total": total, "results": [_game_dict(r) for r in rows]}


def _get_game(conn, gid: str):
    g = conn.execute(select(games).where(games.c.id == gid)).mappings().first()
    if g is None:
        raise HTTPException(404, f"Game {gid} not found")
    return g


@app.get("/api/games/{gid}")
def game_detail(gid: str) -> dict[str, Any]:
    with get_engine().connect() as conn:
        g = _get_game(conn, gid)
        rows = conn.execute(
            select(game_players, players.c.name)
            .join(players, players.c.id == game_players.c.player_id)
            .where(game_players.c.game_id == gid)
        ).mappings().all()
        last_elapsed = conn.execute(
            select(func.max(pir_timeline.c.elapsed_seconds)).where(pir_timeline.c.game_id == gid)
        ).scalar()
    out = _game_dict(g)
    out["players"] = sorted(
        [{**_clean(dict(r)), "display_name": display_name(r["name"])} for r in rows],
        key=lambda r: (r["team_code"] != g["home_code"], not r["played"], -(r["final_pir"] or 0)),
    )
    max_period = g["max_period"] or 4
    out["game_end_seconds"] = period_end_seconds(max(4, max_period)) if g["status"] != "live" else (last_elapsed or 0)
    out["last_event_elapsed"] = last_elapsed
    out["periods"] = [
        {"period": p, "start": period_end_seconds(p - 1) if p > 1 else 0, "end": period_end_seconds(p),
         "label": f"Q{p}" if p <= 4 else f"OT{p - 4}"}
        for p in range(1, max(4, max_period) + 1)
    ]
    return out


@app.get("/api/games/{gid}/timeline")
def game_timeline(gid: str, players_: str | None = Query(None, alias="players")) -> dict[str, Any]:
    """Cumulative PIR after every PIR-changing event, per player."""
    with get_engine().connect() as conn:
        _get_game(conn, gid)
        q = select(pir_timeline).where(pir_timeline.c.game_id == gid)
        if players_:
            q = q.where(pir_timeline.c.player_id.in_(players_.split(",")))
        rows = conn.execute(q.order_by(pir_timeline.c.player_id, pir_timeline.c.seq)).mappings().all()
    out: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        d = dict(r)
        d.pop("game_id")
        out.setdefault(d.pop("player_id"), []).append(d)
    return {"game_id": gid, "timelines": out}


@app.get("/api/games/{gid}/pir-at")
def game_pir_at(gid: str, t: int | None = None, minute: float | None = None, quarter: int | None = None) -> dict[str, Any]:
    """Every participant's cumulative PIR after all events up to elapsed time t."""
    t_val = _time_param(t, minute, quarter)
    with get_engine().connect() as conn:
        g = _get_game(conn, gid)
        last = (
            select(pir_timeline.c.player_id, func.max(pir_timeline.c.seq).label("seq"))
            .where(pir_timeline.c.game_id == gid, pir_timeline.c.elapsed_seconds <= t_val)
            .group_by(pir_timeline.c.player_id).subquery()
        )
        tl = pir_timeline.alias("tl")
        rows = conn.execute(
            select(game_players.c.player_id, players.c.name, game_players.c.team_code, game_players.c.played,
                   func.coalesce(tl.c.pir, 0).label("pir"), tl.c.play_info.label("last_event"),
                   tl.c.elapsed_seconds.label("last_event_elapsed"))
            .select_from(
                game_players.join(players, players.c.id == game_players.c.player_id)
                .outerjoin(last, last.c.player_id == game_players.c.player_id)
                .outerjoin(tl, and_(tl.c.game_id == gid, tl.c.player_id == last.c.player_id, tl.c.seq == last.c.seq))
            )
            .where(game_players.c.game_id == gid)
            .order_by(func.coalesce(tl.c.pir, 0).desc())
        ).mappings().all()
    period, clock = game_clock_for_elapsed(t_val)
    return {
        "game_id": gid, "t": t_val, "period": period, "clock": clock, "status": g["status"],
        "players": [{**dict(r), "display_name": display_name(r["name"])} for r in rows],
    }


@app.get("/api/games/{gid}/events")
def game_events(gid: str, player: str | None = None) -> dict[str, Any]:
    from .db import events as ev
    with get_engine().connect() as conn:
        _get_game(conn, gid)
        q = select(ev).where(ev.c.game_id == gid)
        if player:
            q = q.where(ev.c.player_id == player)
        rows = conn.execute(q.order_by(ev.c.seq)).mappings().all()
    return {"game_id": gid, "events": [dict(r) for r in rows]}


# ------------------------------------------------------------------ live

@app.get("/api/live")
def live() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    with get_engine().connect() as conn:
        cols = [c for c in games.c if c.name not in ("validation", "warnings")]
        live_rows = conn.execute(select(*cols).where(games.c.status == "live").order_by(games.c.utc_date)).mappings().all()
        upcoming = conn.execute(
            select(*cols).where(games.c.status == "scheduled", games.c.utc_date >= now)
            .order_by(games.c.utc_date).limit(10)
        ).mappings().all()
        recent = conn.execute(
            select(*cols).where(games.c.status == "final", games.c.pbp_imported_at.is_not(None))
            .order_by(games.c.utc_date.desc()).limit(10)
        ).mappings().all()
        poller = conn.execute(select(sync_state).where(sync_state.c.key == "live_poller")).mappings().first()
    poller_info = None
    if poller:
        ua = poller["updated_at"]
        ua = ua if ua is None or ua.tzinfo else ua.replace(tzinfo=timezone.utc)
        poller_info = {**(poller["value"] or {}), "heartbeat": _iso(ua),
                       "alive": bool(ua and (now - ua).total_seconds() < max(120, 6 * config.LIVE_POLL_INTERVAL))}
    return {
        "now": now.isoformat(),
        "poll_interval": config.LIVE_POLL_INTERVAL,
        "stale_after": config.LIVE_STALE_AFTER,
        "poller": poller_info,
        "live": [_game_dict(r) for r in live_rows],
        "upcoming": [_game_dict(r) for r in upcoming],
        "recent": [_game_dict(r) for r in recent],
    }


# ------------------------------------------------------------------ players

@app.get("/api/players")
def list_players(q: str | None = None, team: str | None = None, season: str | None = None,
                 limit: int = Query(50, le=500), offset: int = 0) -> dict[str, Any]:
    gp = select(
        game_players.c.player_id,
        func.count().label("games"),
        func.avg(game_players.c.final_pir).label("avg_pir"),
        func.max(game_players.c.final_pir).label("best_pir"),
    ).select_from(game_players.join(games, games.c.id == game_players.c.game_id)).where(
        game_players.c.played.is_(True), games.c.status.in_(("final", "live"))
    )
    if season:
        gp = gp.where(games.c.season_code == season)
    if team:
        gp = gp.where(game_players.c.team_code == team.upper())
    gp = gp.group_by(game_players.c.player_id).subquery()
    base = select(players, gp.c.games, gp.c.avg_pir, gp.c.best_pir).join(gp, gp.c.player_id == players.c.id)
    if q:
        terms = [w for w in q.replace(",", " ").split() if w]
        for w in terms:
            base = base.where(or_(players.c.name.ilike(f"%{w}%"), players.c.id.ilike(f"%{w}%")))
    with get_engine().connect() as conn:
        total = conn.execute(select(func.count()).select_from(base.subquery())).scalar_one()
        rows = conn.execute(base.order_by(gp.c.games.desc(), players.c.name).limit(limit).offset(offset)).mappings().all()
    return {"total": total, "results": [
        {**_clean(dict(r)), "display_name": display_name(r["name"]),
         "avg_pir": round(float(r["avg_pir"]), 2) if r["avg_pir"] is not None else None} for r in rows
    ]}


@app.get("/api/players/{pid}")
def player_profile(pid: str, season: str | None = None) -> dict[str, Any]:
    with get_engine().connect() as conn:
        p = conn.execute(select(players).where(players.c.id == pid)).mappings().first()
        if p is None:
            raise HTTPException(404, f"Player {pid} not found")
        q = (
            select(game_players, games.c.season_code, games.c.game_code, games.c.utc_date, games.c.round,
                   games.c.home_code, games.c.away_code, games.c.home_name, games.c.away_name,
                   games.c.home_score, games.c.away_score, games.c.status, games.c.validation_status, games.c.max_period)
            .join(games, games.c.id == game_players.c.game_id)
            .where(game_players.c.player_id == pid, game_players.c.played.is_(True), games.c.status.in_(("final", "live")))
        )
        if season:
            q = q.where(games.c.season_code == season)
        rows = conn.execute(q.order_by(games.c.utc_date.desc())).mappings().all()
        gids = [r["game_id"] for r in rows]
        cps: dict[str, dict[int, int]] = {}
        if gids:
            for chunk in range(0, len(gids), 500):
                for r in conn.execute(
                    select(pir_minutes.c.game_id, pir_minutes.c.minute, pir_minutes.c.pir).where(
                        pir_minutes.c.player_id == pid,
                        pir_minutes.c.game_id.in_(gids[chunk:chunk + 500]),
                        pir_minutes.c.minute.in_(CHECKPOINT_MINUTES),
                    )
                ):
                    cps.setdefault(r.game_id, {})[r.minute] = r.pir
        seasons_played = sorted({r[0] for r in conn.execute(
            select(games.c.season_code).join(game_players, games.c.id == game_players.c.game_id)
            .where(game_players.c.player_id == pid, game_players.c.played.is_(True)).distinct()
        )}, reverse=True)
    games_out = []
    sums: dict[int, list[int]] = {m: [] for m in CHECKPOINT_MINUTES}
    for r in rows:
        d = _clean(dict(r))
        d.pop("box", None)
        cp = cps.get(r["game_id"], {})
        d["checkpoints"] = {str(m): cp.get(m) for m in CHECKPOINT_MINUTES}
        for m in CHECKPOINT_MINUTES:
            if cp.get(m) is not None:
                sums[m].append(cp[m])
        games_out.append(d)
    finals = [g["final_pir"] for g in games_out if g["final_pir"] is not None]
    averages = {str(m): (round(sum(v) / len(v), 2) if v else None) for m, v in sums.items()}
    return {
        "player": {**_clean(dict(p)), "display_name": display_name(p["name"])},
        "seasons": seasons_played,
        "summary": {
            "games": len(games_out),
            "avg_final_pir": round(sum(finals) / len(finals), 2) if finals else None,
            "best_final_pir": max(finals) if finals else None,
            "worst_final_pir": min(finals) if finals else None,
            "avg_max_pir": round(sum(g["max_pir"] or 0 for g in games_out) / len(games_out), 2) if games_out else None,
            "avg_min_pir": round(sum(g["min_pir"] or 0 for g in games_out) / len(games_out), 2) if games_out else None,
            "avg_at_minute": averages,
        },
        "games": games_out,
    }


@app.get("/api/players/{pid}/at-time")
def player_at_time(pid: str, t: int | None = None, minute: float | None = None, quarter: int | None = None,
                   last: int = Query(20, le=500), season: str | None = None) -> dict[str, Any]:
    t_val = _time_param(t, minute, quarter)
    with get_engine().connect() as conn:
        res = player_at_time_series(conn, pid, t_val, last=last, season=season)
    vals = [r["pir"] for r in res]
    return {"player_id": pid, "t": t_val, "games": res,
            "average": round(sum(vals) / len(vals), 2) if vals else None}


# ------------------------------------------------------------------ search

def _filters(season, team, opponent, player, date_from, date_to, validated_only) -> Filters:
    return Filters(season=season, team=team, opponent=opponent, player=player,
                   date_from=_parse_date(date_from), date_to=_parse_date(date_to), only_validated=validated_only)


@app.get("/api/search/at-time")
def search_at_time(
    t: int | None = None, minute: float | None = None, quarter: int | None = None,
    min_pir: int | None = None, max_pir: int | None = None,
    season: str | None = None, team: str | None = None, opponent: str | None = None, player: str | None = None,
    date_from: str | None = None, date_to: str | None = None, validated_only: bool = False,
    sort: str = Query("desc", pattern="^(asc|desc|date)$"), limit: int = Query(100, le=1000), offset: int = 0,
) -> dict[str, Any]:
    """e.g. PIR >= 20 at minute 12; PIR > 15 at end of Q3; highest PIR at minute 20."""
    t_val = _time_param(t, minute, quarter)
    with get_engine().connect() as conn:
        return pir_at_time(conn, t_val, _filters(season, team, opponent, player, date_from, date_to, validated_only),
                           min_pir=min_pir, max_pir=max_pir, sort=sort, limit=limit, offset=offset)


@app.get("/api/search/reached")
def search_reached(
    threshold: int, t_from: int = 0, t_to: int | None = None, before_quarter_end: int | None = None,
    season: str | None = None, team: str | None = None, opponent: str | None = None, player: str | None = None,
    date_from: str | None = None, date_to: str | None = None, validated_only: bool = False,
    limit: int = Query(100, le=1000), offset: int = 0,
) -> dict[str, Any]:
    """e.g. every game where a player reached PIR 25 before halftime (before_quarter_end=2)."""
    if t_to is None:
        t_to = period_end_seconds(before_quarter_end) if before_quarter_end else 10_000
    with get_engine().connect() as conn:
        res = reached(conn, threshold, t_from, t_to,
                      _filters(season, team, opponent, player, date_from, date_to, validated_only), limit, offset)
    return {**res, "threshold": threshold, "t_from": t_from, "t_to": t_to}


@app.get("/api/search/drops")
def search_drops(
    min_drop: int = 10,
    season: str | None = None, team: str | None = None, opponent: str | None = None, player: str | None = None,
    date_from: str | None = None, date_to: str | None = None, validated_only: bool = False,
    limit: int = Query(100, le=1000), offset: int = 0,
) -> dict[str, Any]:
    """Players whose PIR fell by at least `min_drop` from an in-game peak."""
    with get_engine().connect() as conn:
        res = drops(conn, min_drop, _filters(season, team, opponent, player, date_from, date_to, validated_only), limit, offset)
    return {**res, "min_drop": min_drop}


@app.get("/api/teams")
def teams(season: str | None = None) -> list[dict[str, Any]]:
    q = select(games.c.home_code, games.c.home_name, games.c.home_crest)
    if season:
        q = q.where(games.c.season_code == season)
    with get_engine().connect() as conn:
        rows = conn.execute(q.distinct()).all()
    seen: dict[str, dict[str, Any]] = {}
    for code, name, crest in rows:
        if code and code not in seen:
            seen[code] = {"code": code, "name": name, "crest": crest}
    return sorted(seen.values(), key=lambda t: t["name"] or t["code"])
