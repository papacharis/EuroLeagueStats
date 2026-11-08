"""Database schema (SQLAlchemy Core).  PostgreSQL in production; SQLite works
for tests.  `init_db()` is idempotent and is called on API / worker start-up."""

from __future__ import annotations

from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
)
from sqlalchemy.engine import Engine

from . import config

metadata = MetaData()

seasons = Table(
    "seasons",
    metadata,
    Column("code", String(16), primary_key=True),  # e.g. E2025
    Column("name", String(64)),
    Column("alias", String(16)),
    Column("year", Integer, index=True),
    Column("start_date", DateTime),
    Column("end_date", DateTime),
    Column("pbp_supported", Boolean, default=True),
    Column("games_total", Integer, default=0),
    Column("schedule_synced_at", DateTime(timezone=True)),
)

games = Table(
    "games",
    metadata,
    Column("id", String(24), primary_key=True),  # "{season}_{gamecode}"
    Column("season_code", String(16), nullable=False, index=True),
    Column("game_code", Integer, nullable=False),
    Column("round", Integer),
    Column("round_name", String(64)),
    Column("phase", String(64)),
    Column("utc_date", DateTime(timezone=True), index=True),
    Column("home_code", String(8), index=True),
    Column("home_name", String(128)),
    Column("home_crest", Text),
    Column("away_code", String(8), index=True),
    Column("away_name", String(128)),
    Column("away_crest", Text),
    Column("home_score", Integer),
    Column("away_score", Integer),
    Column("source_status", String(32)),  # v2 gameStatus
    Column("played", Boolean, default=False),
    # scheduled | live | final | postponed | no_data
    Column("status", String(16), nullable=False, default="scheduled", index=True),
    Column("current_period", Integer),
    Column("current_clock", String(8)),
    Column("max_period", Integer),
    Column("num_events", Integer, default=0),
    Column("pbp_imported_at", DateTime(timezone=True)),
    Column("last_live_update", DateTime(timezone=True)),
    Column("last_attempt_at", DateTime(timezone=True)),
    Column("last_error", Text),
    # pending | ok | mismatch | no_boxscore | incomplete | live
    Column("validation_status", String(16), default="pending", index=True),
    Column("validation", JSON),
    Column("warnings", JSON),
)
Index("ix_games_season_code_game", games.c.season_code, games.c.game_code, unique=True)

players = Table(
    "players",
    metadata,
    Column("id", String(16), primary_key=True),  # EuroLeague person code, e.g. P007200
    Column("name", String(128), index=True),
    Column("last_team_code", String(8)),
    Column("last_team_name", String(128)),
    Column("last_game_date", DateTime(timezone=True)),
)

game_players = Table(
    "game_players",
    metadata,
    Column("game_id", String(24), primary_key=True),
    Column("player_id", String(16), primary_key=True),
    Column("team_code", String(8), index=True),
    Column("opponent_code", String(8), index=True),
    Column("dorsal", String(4)),
    Column("is_starter", Boolean),
    Column("minutes", String(8)),
    Column("played", Boolean, default=True),
    Column("box", JSON),  # official box-score line
    Column("official_pir", Integer),
    Column("final_pir", Integer, index=True),
    Column("max_pir", Integer, index=True),
    Column("max_pir_elapsed", Integer),
    Column("min_pir", Integer),
    Column("min_pir_elapsed", Integer),
    Column("max_drop", Integer, index=True),
    Column("validated", Boolean),
)
Index("ix_game_players_player", game_players.c.player_id, game_players.c.game_id)

events = Table(
    "events",
    metadata,
    Column("game_id", String(24), primary_key=True),
    Column("seq", Integer, primary_key=True),
    Column("number_of_play", Integer),
    Column("period", Integer),
    Column("marker_time", String(8)),
    Column("elapsed_seconds", Integer),
    Column("play_type", String(12)),
    Column("play_info", String(128)),
    Column("player_id", String(16)),
    Column("team_code", String(8)),
    Column("points_a", Integer),
    Column("points_b", Integer),
    Column("pir_delta", Integer),
)

# One row per PIR-changing event per player: the cumulative PIR after it.
pir_timeline = Table(
    "pir_timeline",
    metadata,
    Column("game_id", String(24), primary_key=True),
    Column("player_id", String(16), primary_key=True),
    Column("seq", Integer, primary_key=True),
    Column("elapsed_seconds", Integer, nullable=False),
    Column("period", Integer),
    Column("marker_time", String(8)),
    Column("play_type", String(12)),
    Column("play_info", String(128)),
    Column("delta", Integer),
    Column("pir", Integer, nullable=False),
)
Index("ix_timeline_player_game_time", pir_timeline.c.player_id, pir_timeline.c.game_id, pir_timeline.c.elapsed_seconds, pir_timeline.c.seq)
Index("ix_timeline_game_time", pir_timeline.c.game_id, pir_timeline.c.elapsed_seconds)

# Cumulative PIR at the end of every elapsed minute (0..40 plus overtime),
# materialised for fast cross-game search ("PIR >= 20 at minute 12").
pir_minutes = Table(
    "pir_minutes",
    metadata,
    Column("game_id", String(24), primary_key=True),
    Column("player_id", String(16), primary_key=True),
    Column("minute", Integer, primary_key=True),
    Column("pir", Integer, nullable=False),
)
Index("ix_pir_minutes_minute_pir", pir_minutes.c.minute, pir_minutes.c.pir)
Index("ix_pir_minutes_player", pir_minutes.c.player_id, pir_minutes.c.minute)

sync_state = Table(
    "sync_state",
    metadata,
    Column("key", String(64), primary_key=True),
    Column("value", JSON),
    Column("updated_at", DateTime(timezone=True)),
)

_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        url = config.DATABASE_URL
        kwargs: dict[str, Any] = {"future": True}
        if url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        else:
            kwargs.update(pool_size=10, max_overflow=10, pool_pre_ping=True)
        _engine = create_engine(url, **kwargs)
    return _engine


def set_engine(engine: Engine) -> None:
    global _engine
    _engine = engine


def init_db(engine: Engine | None = None) -> None:
    metadata.create_all(engine or get_engine())


def upsert(conn, table: Table, rows: list[dict[str, Any]], keys: list[str]) -> None:
    """INSERT ... ON CONFLICT (keys) DO UPDATE for PostgreSQL and SQLite."""
    if not rows:
        return
    dialect = conn.engine.dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:  # pragma: no cover
        raise NotImplementedError(dialect)
    cols = set().union(*(r.keys() for r in rows))
    for chunk_start in range(0, len(rows), 500):
        chunk = rows[chunk_start:chunk_start + 500]
        stmt = insert(table).values(chunk)
        update_cols = {c: stmt.excluded[c] for c in cols if c not in keys}
        if update_cols:
            stmt = stmt.on_conflict_do_update(index_elements=keys, set_=update_cols)
        else:
            stmt = stmt.on_conflict_do_nothing(index_elements=keys)
        conn.execute(stmt)
