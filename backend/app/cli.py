"""Command-line entry points.

  python -m app.cli init-db
  python -m app.cli seasons
  python -m app.cli schedule E2025
  python -m app.cli import-game E2025 1
  python -m app.cli import-season E2025 [--limit N]
  python -m app.cli backfill [--from-year 2007]
  python -m app.cli reimport [E2025]   # re-fetch + re-process imported games (after engine changes)
  python -m app.cli worker            # scheduler + live poller
"""

from __future__ import annotations

import argparse
import json
import logging

from .db import init_db
from .euroleague_client import EuroLeagueClient


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(prog="pir")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    sub.add_parser("seasons")
    p = sub.add_parser("schedule")
    p.add_argument("season")
    p = sub.add_parser("import-game")
    p.add_argument("season")
    p.add_argument("game_code", type=int)
    p = sub.add_parser("import-season")
    p.add_argument("season")
    p.add_argument("--limit", type=int)
    p = sub.add_parser("reimport")
    p.add_argument("season", nargs="?", help="omit to re-process every imported game")
    p = sub.add_parser("backfill")
    p.add_argument("--from-year", type=int)
    sub.add_parser("worker")
    args = ap.parse_args(argv)

    init_db()
    if args.cmd == "init-db":
        return
    if args.cmd == "worker":
        from .worker import run_worker
        run_worker()
        return

    from . import importer

    client = EuroLeagueClient()
    try:
        if args.cmd == "seasons":
            print(importer.sync_seasons(client))
        elif args.cmd == "schedule":
            importer.sync_seasons(client)
            print(importer.sync_schedule(client, args.season), "games")
        elif args.cmd == "import-game":
            importer.sync_seasons(client)
            importer.sync_schedule(client, args.season)
            print(json.dumps(importer.import_game(client, args.season, args.game_code), indent=2))
        elif args.cmd == "import-season":
            importer.sync_seasons(client)
            print(importer.import_season(client, args.season, limit=args.limit))
        elif args.cmd == "reimport":
            from sqlalchemy import select

            from .db import games, get_engine

            q = select(games.c.season_code, games.c.game_code).where(games.c.pbp_imported_at.is_not(None))
            if args.season:
                q = q.where(games.c.season_code == args.season)
            with get_engine().connect() as conn:
                todo = conn.execute(q.order_by(games.c.utc_date)).all()
            for season, code in todo:
                try:
                    r = importer.import_game(client, season, code)
                    print(season, code, r["validation"])
                except Exception as exc:  # keep going
                    print(season, code, "FAILED", exc)
        elif args.cmd == "backfill":
            codes = importer.sync_seasons(client)
            for code in codes:
                year = int(code[1:])
                if args.from_year and year < args.from_year:
                    continue
                print(importer.import_season(client, code))
    finally:
        client.close()


if __name__ == "__main__":
    main()
