import os


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql+psycopg://postgres@127.0.0.1:5432/pir")

COMPETITION = os.environ.get("EL_COMPETITION", "E")  # E = EuroLeague, U = EuroCup
# Play-by-play data is published from the 2007-08 season onwards.
FIRST_PBP_SEASON_YEAR = int(os.environ.get("EL_FIRST_PBP_SEASON", "2007"))

LIVE_API_BASE = os.environ.get("EL_LIVE_API_BASE", "https://live.euroleague.net/api")
V2_API_BASE = os.environ.get("EL_V2_API_BASE", "https://api-live.euroleague.net/v2")
# The feed rejects requests without a browser-like User-Agent.
USER_AGENT = os.environ.get("EL_USER_AGENT", "Mozilla/5.0 (compatible; EuroLeague-PIR-Tracker/1.0)")

HTTP_TIMEOUT = _float("EL_HTTP_TIMEOUT", 20)
# Minimum spacing between requests to the public feed during bulk imports.
# The feed sits behind Cloudflare and answers 429 at roughly >100 req/min;
# 1 request/second keeps a full historical backfill polite (~4 hours).
REQUEST_INTERVAL = _float("EL_REQUEST_INTERVAL", 1.0)

# Live polling cadence (seconds) for in-progress games.
LIVE_POLL_INTERVAL = _float("EL_LIVE_POLL_INTERVAL", 10)
# How often to refresh the schedule to detect games about to start / live.
SCHEDULE_REFRESH_INTERVAL = _float("EL_SCHEDULE_REFRESH_INTERVAL", 300)
# A live game whose last successful update is older than this is "delayed".
LIVE_STALE_AFTER = _float("EL_LIVE_STALE_AFTER", 45)

CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
