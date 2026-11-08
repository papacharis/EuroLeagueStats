"""Thin client for the public EuroLeague data feeds.

Endpoints (all verified against the live service):
  v2 seasons   GET {V2}/competitions/{comp}/seasons
  v2 games     GET {V2}/competitions/{comp}/seasons/{season}/games
  play-by-play GET {LIVE}/PlayByPlay?gamecode={n}&seasoncode={season}
  box score    GET {LIVE}/Boxscore?gamecode={n}&seasoncode={season}
  header       GET {LIVE}/Header?gamecode={n}&seasoncode={season}

The legacy live.euroleague.net endpoints return HTTP 200 with an empty body
when a game has no data (not yet played / pre-2007 season); that is surfaced
as `NoData` rather than silently treated as an empty game.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any

import httpx

from . import config

log = logging.getLogger(__name__)


class SourceError(Exception):
    """The data source failed (network, HTTP error, malformed payload)."""


class NoData(SourceError):
    """The source responded but has no data for the requested resource."""


class EuroLeagueClient:
    def __init__(self, min_interval: float | None = None, retries: int = 5):
        self.min_interval = config.REQUEST_INTERVAL if min_interval is None else min_interval
        self.retries = retries
        self._last = 0.0
        self._lock = threading.Lock()
        self._http = httpx.Client(
            timeout=config.HTTP_TIMEOUT,
            headers={"User-Agent": config.USER_AGENT, "Accept": "application/json"},
            follow_redirects=True,
        )

    def close(self) -> None:
        self._http.close()

    def _throttle(self) -> None:
        with self._lock:
            wait = self.min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()

    def _get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        last_exc: Exception | None = None
        for attempt in range(self.retries):
            self._throttle()
            try:
                resp = self._http.get(url, params=params)
            except httpx.HTTPError as exc:
                last_exc = exc
                log.warning("GET %s failed (%s), attempt %d", url, exc, attempt + 1)
                time.sleep(2 ** attempt)
                continue
            if resp.status_code == 429:
                # Rate limited: back off hard (15s, 30s, 60s, ...) and slow down.
                last_exc = SourceError(f"HTTP 429 (rate limited) from {url}")
                retry_after = resp.headers.get("Retry-After")
                wait = float(retry_after) if retry_after and retry_after.isdigit() else min(300, 15 * 2 ** attempt)
                log.warning("rate limited by %s; sleeping %.0fs", url, wait)
                self.min_interval = min(5.0, max(self.min_interval * 1.5, 1.0))
                time.sleep(wait)
                continue
            if resp.status_code in (500, 502, 503, 504):
                last_exc = SourceError(f"HTTP {resp.status_code} from {url}")
                time.sleep(2 ** (attempt + 1))
                continue
            if resp.status_code == 404:
                raise NoData(f"404 from {url} {params or ''}")
            if resp.status_code >= 400:
                raise SourceError(f"HTTP {resp.status_code} from {url} {params or ''}")
            body = resp.content.strip()
            if not body:
                raise NoData(f"Empty response from {url} {params or ''}")
            try:
                return json.loads(body)
            except ValueError as exc:
                raise SourceError(f"Invalid JSON from {url}: {exc}") from exc
        raise SourceError(f"Giving up on {url} {params or ''}: {last_exc}")

    # ------------------------------------------------------------ endpoints
    def seasons(self, competition: str = config.COMPETITION) -> list[dict[str, Any]]:
        data = self._get_json(f"{config.V2_API_BASE}/competitions/{competition}/seasons")
        return data.get("data", data) if isinstance(data, dict) else data

    def games(self, season: str, competition: str = config.COMPETITION) -> list[dict[str, Any]]:
        data = self._get_json(f"{config.V2_API_BASE}/competitions/{competition}/seasons/{season}/games")
        return data.get("data", data) if isinstance(data, dict) else data

    def _legacy(self, name: str, season: str, game_code: int) -> dict[str, Any]:
        return self._get_json(f"{config.LIVE_API_BASE}/{name}", {"gamecode": game_code, "seasoncode": season})

    def play_by_play(self, season: str, game_code: int) -> dict[str, Any]:
        return self._legacy("PlayByPlay", season, game_code)

    def box_score(self, season: str, game_code: int) -> dict[str, Any]:
        return self._legacy("Boxscore", season, game_code)

    def header(self, season: str, game_code: int) -> dict[str, Any]:
        return self._legacy("Header", season, game_code)
