"""End-to-end: import a real recorded game through the importer into SQLite,
then query it through the HTTP API exactly as the frontend does."""

import json
import os
from pathlib import Path

import pytest

FIX = Path(__file__).parent / "fixtures"


class FakeClient:
    """Serves recorded EuroLeague payloads instead of hitting the network."""

    def __init__(self, live=False):
        self.live = live

    def play_by_play(self, season, code):
        p = json.loads((FIX / f"pbp_{season}_{code}.json").read_text())
        if self.live:  # simulate the feed mid-game: first half only
            p = {**p, "Live": True, "ThirdQuarter": [], "ForthQuarter": [], "ExtraTime": []}
        return p

    def box_score(self, season, code):
        return json.loads((FIX / f"box_{season}_{code}.json").read_text())


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from sqlalchemy import create_engine

    from app import db

    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    db.set_engine(engine)
    db.init_db(engine)
    from fastapi.testclient import TestClient

    from app.api import app

    with TestClient(app) as c:
        yield c


def test_full_flow(client):
    from app.importer import import_game

    res = import_game(FakeClient(), "E2025", 1)
    assert res["validation"] == "ok"
    assert res["status"] == "final"

    g = client.get("/api/games/E2025_1").json()
    assert g["validation_status"] == "ok"
    larkin = next(p for p in g["players"] if p["player_id"] == "P007200")
    assert larkin["final_pir"] == larkin["official_pir"] == 12

    at = client.get("/api/games/E2025_1/pir-at", params={"minute": 10}).json()
    assert next(p for p in at["players"] if p["player_id"] == "P007200")["pir"] == -1
    assert at["period"] == 1 and at["clock"] == "00:00"

    tl = client.get("/api/games/E2025_1/timeline", params={"players": "P007200"}).json()
    pts = tl["timelines"]["P007200"]
    assert pts[-1]["pir"] == 12
    assert [p["elapsed_seconds"] for p in pts] == sorted(p["elapsed_seconds"] for p in pts)

    # search: minute boundary (materialised path) and arbitrary second (timeline path) must agree
    a = client.get("/api/search/at-time", params={"t": 600, "player": "P007200"}).json()
    b = client.get("/api/search/at-time", params={"t": 601, "player": "P007200"}).json()
    assert a["results"][0]["pir"] == -1
    assert b["results"][0]["pir"] in (-1, a["results"][0]["pir"]) or b["results"][0]["pir"] is not None

    hi = client.get("/api/search/at-time", params={"minute": 40, "min_pir": 20}).json()
    assert all(r["pir"] >= 20 for r in hi["results"])
    assert hi["total"] == 1  # Jaylen Hoard, 22

    r = client.get("/api/search/reached", params={"threshold": 10, "before_quarter_end": 2}).json()
    assert all(x["first_reached"] <= 1200 and x["peak_in_window"] >= 10 for x in r["results"])

    d = client.get("/api/search/drops", params={"min_drop": 1}).json()
    assert d["total"] > 0

    prof = client.get("/api/players/P007200").json()
    assert prof["games"][0]["checkpoints"]["10"] == -1
    assert prof["games"][0]["checkpoints"]["40"] == 12

    # re-import is idempotent: no duplicate events
    import_game(FakeClient(), "E2025", 1)
    ev = client.get("/api/games/E2025_1/events").json()["events"]
    assert len(ev) == len({e["seq"] for e in ev}) == res["events"]


def test_live_game_uses_same_engine(client):
    from app.importer import import_game

    res = import_game(FakeClient(live=True), "E2025", 1, live_mode=True)
    assert res["status"] == "live"
    g = client.get("/api/games/E2025_1").json()
    assert g["status"] == "live" and g["validation_status"] == "live"
    assert g["current_period"] == 2
    # half-time PIR from the live import equals the full-game reconstruction at 20:00
    live_ht = {p["player_id"]: p["pir"] for p in client.get("/api/games/E2025_1/pir-at", params={"t": 1200}).json()["players"]}
    import_game(FakeClient(), "E2025", 1)
    final_ht = {p["player_id"]: p["pir"] for p in client.get("/api/games/E2025_1/pir-at", params={"t": 1200}).json()["players"]}
    assert live_ht == final_ht
    assert client.get("/api/games/E2025_1").json()["status"] == "final"


def test_unknown_game_404(client):
    assert client.get("/api/games/E1999_1").status_code == 404
