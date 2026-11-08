"""Read-side queries shared by the API: timelines, PIR-at-time, search."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import and_, case, func, literal, or_, select
from sqlalchemy.sql import Select

from .db import game_players, games, pir_minutes, pir_timeline, players


def display_name(raw: str | None) -> str | None:
    """'LARKIN, SHANE' -> 'Shane Larkin';  'WEILER-BABB, NICK' -> 'Nick Weiler-Babb'."""
    if not raw:
        return raw
    if "," in raw:
        last, first = [p.strip() for p in raw.split(",", 1)]
        raw = f"{first} {last}".strip()
    return raw.title()


def game_end_seconds_expr():
    """Elapsed seconds at which the game's last period ends."""
    mp = func.coalesce(games.c.max_period, 4)
    return case((mp <= 4, mp * 600), else_=2400 + (mp - 4) * 300)


class Filters:
    def __init__(self, season: str | None = None, team: str | None = None, opponent: str | None = None,
                 player: str | None = None, date_from: datetime | None = None, date_to: datetime | None = None,
                 game: str | None = None, only_validated: bool = False):
        self.season, self.team, self.opponent, self.player = season, team, opponent, player
        self.date_from, self.date_to, self.game, self.only_validated = date_from, date_to, game, only_validated

    def apply(self, q: Select) -> Select:
        conds = [games.c.status.in_(("final", "live")), game_players.c.played.is_(True)]
        if self.season:
            conds.append(games.c.season_code.in_(self.season.split(",")))
        if self.team:
            conds.append(game_players.c.team_code.in_(self.team.upper().split(",")))
        if self.opponent:
            conds.append(game_players.c.opponent_code.in_(self.opponent.upper().split(",")))
        if self.player:
            ids = [p for p in self.player.split(",") if p]
            if all(p.upper().startswith("P") and p[1:].isdigit() for p in ids):
                conds.append(game_players.c.player_id.in_(ids))
            else:
                conds.append(players.c.name.ilike(f"%{self.player}%"))
        if self.date_from:
            conds.append(games.c.utc_date >= self.date_from)
        if self.date_to:
            conds.append(games.c.utc_date <= self.date_to)
        if self.game:
            conds.append(games.c.id == self.game)
        if self.only_validated:
            conds.append(games.c.validation_status == "ok")
        return q.where(and_(*conds))


def _base_columns():
    return [
        game_players.c.game_id,
        game_players.c.player_id,
        players.c.name.label("player_name"),
        game_players.c.team_code,
        game_players.c.opponent_code,
        game_players.c.final_pir,
        game_players.c.max_pir,
        game_players.c.min_pir,
        game_players.c.max_drop,
        game_players.c.minutes,
        games.c.season_code,
        games.c.game_code,
        games.c.utc_date,
        games.c.round,
        games.c.home_code,
        games.c.away_code,
        games.c.home_score,
        games.c.away_score,
        games.c.status,
        games.c.validation_status,
    ]


def _from():
    return game_players.join(games, games.c.id == game_players.c.game_id).join(
        players, players.c.id == game_players.c.player_id
    )


def _row(r) -> dict[str, Any]:
    d = dict(r._mapping)
    d["player_display_name"] = display_name(d.get("player_name"))
    if isinstance(d.get("utc_date"), datetime):
        d["utc_date"] = d["utc_date"].isoformat()
    return d


def pir_at_time(conn, t: int, f: Filters, min_pir: int | None = None, max_pir: int | None = None,
                sort: str = "desc", limit: int = 100, offset: int = 0) -> dict[str, Any]:
    """Cumulative PIR for every player-game at elapsed second `t`."""
    if t % 60 == 0:
        pir_col = func.coalesce(pir_minutes.c.pir, 0)
        src = _from().join(
            pir_minutes,
            and_(pir_minutes.c.game_id == game_players.c.game_id,
                 pir_minutes.c.player_id == game_players.c.player_id,
                 pir_minutes.c.minute == t // 60),
        )
    else:
        last = (
            select(pir_timeline.c.game_id, pir_timeline.c.player_id, func.max(pir_timeline.c.seq).label("seq"))
            .where(pir_timeline.c.elapsed_seconds <= t)
            .group_by(pir_timeline.c.game_id, pir_timeline.c.player_id)
            .subquery()
        )
        tl = pir_timeline.alias("tl")
        pir_col = func.coalesce(tl.c.pir, 0)
        src = (
            _from()
            .outerjoin(last, and_(last.c.game_id == game_players.c.game_id, last.c.player_id == game_players.c.player_id))
            .outerjoin(tl, and_(tl.c.game_id == last.c.game_id, tl.c.player_id == last.c.player_id, tl.c.seq == last.c.seq))
        )
    q = select(*_base_columns(), pir_col.label("pir")).select_from(src)
    q = f.apply(q).where(game_end_seconds_expr() >= t)
    if min_pir is not None:
        q = q.where(pir_col >= min_pir)
    if max_pir is not None:
        q = q.where(pir_col <= max_pir)
    total = conn.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    if sort == "date":
        order = [games.c.utc_date.desc()]
    else:
        order = [pir_col.desc() if sort == "desc" else pir_col.asc(), games.c.utc_date.desc()]
    rows = conn.execute(q.order_by(*order).limit(limit).offset(offset)).all()
    return {"total": total, "t": t, "results": [_row(r) for r in rows]}


def reached(conn, threshold: int, t_from: int, t_to: int, f: Filters, limit: int = 100, offset: int = 0) -> dict[str, Any]:
    """Player-games whose PIR reached `threshold` between t_from and t_to (inclusive)."""
    agg = (
        select(
            pir_timeline.c.game_id,
            pir_timeline.c.player_id,
            func.max(pir_timeline.c.pir).label("peak_in_window"),
            func.min(case((pir_timeline.c.pir >= threshold, pir_timeline.c.elapsed_seconds))).label("first_reached"),
        )
        .where(pir_timeline.c.elapsed_seconds.between(t_from, t_to))
        .group_by(pir_timeline.c.game_id, pir_timeline.c.player_id)
        .having(func.max(pir_timeline.c.pir) >= threshold)
        .subquery()
    )
    src = _from().join(agg, and_(agg.c.game_id == game_players.c.game_id, agg.c.player_id == game_players.c.player_id))
    q = f.apply(select(*_base_columns(), agg.c.peak_in_window, agg.c.first_reached).select_from(src))
    total = conn.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    rows = conn.execute(q.order_by(agg.c.first_reached.asc(), agg.c.peak_in_window.desc()).limit(limit).offset(offset)).all()
    return {"total": total, "results": [_row(r) for r in rows]}


def drops(conn, min_drop: int, f: Filters, limit: int = 100, offset: int = 0) -> dict[str, Any]:
    q = f.apply(select(*_base_columns(), game_players.c.max_pir_elapsed, game_players.c.min_pir_elapsed)
                .select_from(_from())).where(game_players.c.max_drop >= min_drop)
    total = conn.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    rows = conn.execute(q.order_by(game_players.c.max_drop.desc(), games.c.utc_date.desc()).limit(limit).offset(offset)).all()
    out = []
    for r in rows:
        d = _row(r)
        d["drop_detail"] = _drop_detail(conn, d["game_id"], d["player_id"])
        out.append(d)
    return {"total": total, "results": out}


def _drop_detail(conn, gid: str, pid: str) -> dict[str, Any] | None:
    pts = conn.execute(
        select(pir_timeline.c.elapsed_seconds, pir_timeline.c.pir)
        .where(pir_timeline.c.game_id == gid, pir_timeline.c.player_id == pid)
        .order_by(pir_timeline.c.seq)
    ).all()
    peak, peak_t, best = 0, 0, None
    for e, p in pts:
        if p > peak:
            peak, peak_t = p, e
        d = peak - p
        if d > 0 and (best is None or d > best["drop"]):
            best = {"drop": d, "from_pir": peak, "from_elapsed": peak_t, "to_pir": p, "to_elapsed": e}
    return best


def player_at_time_series(conn, player_id: str, t: int, last: int = 20, season: str | None = None) -> list[dict[str, Any]]:
    f = Filters(player=player_id, season=season)
    return pir_at_time(conn, t, f, sort="date", limit=last)["results"]
