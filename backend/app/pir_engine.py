"""PIR (Performance Index Rating) reconstruction engine.

Pure functions only - no I/O.  Both the historical importer and the live
poller feed raw EuroLeague play-by-play payloads through `parse_play_by_play`
and `reconstruct`, so historical and live games share exactly one engine.

PIR = Points + Rebounds + Assists + Steals + Blocks + Fouls Drawn
      - Missed FG - Missed FT - Turnovers - Shots Blocked Against
      - Fouls Committed

Every play-by-play row records a single statistical action for a single
player (a made two-pointer and the assist on it are two separate rows), so
mapping each play type to one PIR delta never double-counts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

REGULATION_PERIOD_SECONDS = 600
OVERTIME_PERIOD_SECONDS = 300
REGULATION_PERIODS = 4
CLOCK_REGRESSION_TOLERANCE = 5  # seconds

# The API spells the fourth quarter "ForthQuarter".
QUARTER_KEYS = ("FirstQuarter", "SecondQuarter", "ThirdQuarter", "ForthQuarter")
EXTRA_TIME_KEY = "ExtraTime"

# play type -> (stat name, PIR delta)
PLAY_TYPES: dict[str, tuple[str, int]] = {
    "2FGM": ("fg2_made", 2),
    "3FGM": ("fg3_made", 3),
    "FTM": ("ft_made", 1),
    "2FGA": ("fg2_missed", -1),
    "3FGA": ("fg3_missed", -1),
    "DUNK": ("fg2_made", 2),  # older feeds (c. 2008-2015)
    "LAYUPMD": ("fg2_made", 2),
    "LAYUPATT": ("fg2_missed", -1),
    "2FGAB": ("fg2_missed", -1),  # missed two, blocked (older feeds)
    "3FGAB": ("fg3_missed", -1),  # missed three, blocked (older feeds)
    "FTA": ("ft_missed", -1),
    "O": ("off_rebound", 1),
    "D": ("def_rebound", 1),
    "AS": ("assist", 1),
    "ST": ("steal", 1),
    "FV": ("block", 1),
    "AG": ("blocked_against", -1),
    "RV": ("foul_drawn", 1),
    "TO": ("turnover", -1),
    "CM": ("foul", -1),
    "CMU": ("foul", -1),  # unsportsmanlike
    "CMT": ("foul", -1),  # technical
    "CMD": ("foul", -1),  # disqualifying
    "CMTI": ("foul", -1),  # technical (instigator)
    "OF": ("foul", -1),  # offensive foul
    "CPS": ("foul", -1),  # personal foul, shooting (older feeds)
}

# Foul codes keep multiplying (CMT1, CMU_DI, CMU_FL, ...); every "CM*" code is
# a foul committed by the player on the row.
FOUL_PREFIX = "CM"

# Play types that never move PIR (substitutions, timeouts, period markers...).
NEUTRAL_PLAY_TYPES = {
    "BP", "EP", "EG", "JB", "IN", "OUT", "TOUT", "TOUT_TV", "CCH", "B", "C",
    "TPOFF", "FIN", "STV",
}


@dataclass
class Event:
    seq: int  # chronological index within the game (0-based, API order)
    number_of_play: int | None
    period: int
    marker_time: str  # remaining time in the period, "MM:SS" ("" if unknown)
    elapsed_seconds: int  # seconds elapsed since tip-off, monotonic
    play_type: str
    play_info: str
    player_id: str | None
    player_name: str | None
    team_code: str | None
    dorsal: str | None
    points_a: int | None
    points_b: int | None
    pir_delta: int  # PIR delta for player_id (0 if neutral / team event)
    stat: str | None


@dataclass
class TimelinePoint:
    seq: int
    elapsed_seconds: int
    period: int
    marker_time: str
    play_type: str
    play_info: str
    delta: int
    pir: int


@dataclass
class PlayerReconstruction:
    player_id: str
    player_name: str | None
    team_code: str | None
    dorsal: str | None
    stats: dict[str, int] = field(default_factory=dict)
    timeline: list[TimelinePoint] = field(default_factory=list)

    @property
    def final_pir(self) -> int:
        return self.timeline[-1].pir if self.timeline else 0

    def pir_at(self, elapsed: float) -> int:
        """Cumulative PIR after every event recorded at or before `elapsed`."""
        pir = 0
        for p in self.timeline:
            if p.elapsed_seconds > elapsed:
                break
            pir = p.pir
        return pir

    def summary(self) -> dict[str, Any]:
        """Peak / trough / largest drop (peak followed by a later trough)."""
        max_pir, max_at = 0, 0
        min_pir, min_at = 0, 0
        running_peak, max_drop = 0, 0
        for p in self.timeline:
            if p.pir > max_pir:
                max_pir, max_at = p.pir, p.elapsed_seconds
            if p.pir < min_pir:
                min_pir, min_at = p.pir, p.elapsed_seconds
            running_peak = max(running_peak, p.pir)
            max_drop = max(max_drop, running_peak - p.pir)
        return {
            "final_pir": self.final_pir,
            "max_pir": max_pir,
            "max_pir_elapsed": max_at,
            "min_pir": min_pir,
            "min_pir_elapsed": min_at,
            "max_drop": max_drop,
        }

    def box_like(self) -> dict[str, int]:
        s = self.stats
        g = lambda k: s.get(k, 0)  # noqa: E731
        return {
            "points": 2 * g("fg2_made") + 3 * g("fg3_made") + g("ft_made"),
            "rebounds": g("off_rebound") + g("def_rebound"),
            "assists": g("assist"),
            "steals": g("steal"),
            "blocks": g("block"),
            "blocks_against": g("blocked_against"),
            "fouls_drawn": g("foul_drawn"),
            "fouls": g("foul"),
            "turnovers": g("turnover"),
            "fg_missed": g("fg2_missed") + g("fg3_missed"),
            "ft_missed": g("ft_missed"),
        }


@dataclass
class GameReconstruction:
    events: list[Event]
    players: dict[str, PlayerReconstruction]
    max_period: int
    is_live: bool
    warnings: list[str]
    unknown_play_types: dict[str, int]


# ---------------------------------------------------------------- helpers

def period_start_seconds(period: int) -> int:
    if period <= REGULATION_PERIODS:
        return (period - 1) * REGULATION_PERIOD_SECONDS
    return REGULATION_PERIODS * REGULATION_PERIOD_SECONDS + (period - 5) * OVERTIME_PERIOD_SECONDS


def period_length_seconds(period: int) -> int:
    return REGULATION_PERIOD_SECONDS if period <= REGULATION_PERIODS else OVERTIME_PERIOD_SECONDS


def period_end_seconds(period: int) -> int:
    return period_start_seconds(period) + period_length_seconds(period)


def parse_clock(value: str | None) -> int | None:
    """'MM:SS' remaining -> seconds remaining (None if blank/invalid)."""
    if not value:
        return None
    value = value.strip()
    if not value or ":" not in value:
        return None
    try:
        mm, ss = value.split(":", 1)
        return int(mm) * 60 + int(float(ss))
    except ValueError:
        return None


def format_elapsed(elapsed: int) -> str:
    return f"{elapsed // 60:02d}:{elapsed % 60:02d}"


def game_clock_for_elapsed(elapsed: float) -> tuple[int, str]:
    """Elapsed seconds -> (period, remaining 'MM:SS')."""
    period = 1
    while elapsed > period_end_seconds(period) and period < 20:
        period += 1
    remaining = max(0, int(round(period_end_seconds(period) - elapsed)))
    return period, f"{remaining // 60:02d}:{remaining % 60:02d}"


def _text(v: Any) -> str:
    """str() without NUL bytes (present in some feed rows; rejected by PostgreSQL)."""
    return "" if v is None else str(v).replace("\x00", "")


def _clean(v: Any) -> str | None:
    if v is None:
        return None
    s = _text(v).strip()
    return s or None


def _int_or_none(v: Any) -> int | None:
    try:
        return int(v) if v is not None and str(v).strip() != "" else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- parsing

def is_player_id(pid: str) -> bool:
    """Real person codes look like P007200 or (older) PTGB...; the feed also
    attaches pseudo-ids such as CO_A / CO_B / AC_A to bench and coach rows."""
    return "_" not in pid


def classify_play_type(play_type: str) -> tuple[str, int] | None:
    """(stat, PIR delta) for a play type, or None if it does not affect PIR."""
    if play_type in PLAY_TYPES:
        return PLAY_TYPES[play_type]
    if play_type.startswith(FOUL_PREFIX):
        return ("foul", -1)
    return None


def _iter_raw_events(payload: dict[str, Any]) -> Iterable[tuple[int, dict[str, Any]]]:
    """Yield (period, raw_row) in chronological (API) order."""
    for i, key in enumerate(QUARTER_KEYS, start=1):
        for row in payload.get(key) or []:
            yield i, row
    extra = payload.get(EXTRA_TIME_KEY) or []
    period = REGULATION_PERIODS
    ended = True  # regulation is over when ExtraTime starts
    for row in extra:
        # All overtimes share one array.  Each normally starts with a "Begin
        # Period" row, but some older feeds omit it, so a row following an
        # "End Period" also opens the next overtime.
        pt = (row.get("PLAYTYPE") or "").strip()
        if pt == "BP":
            period += 1
            ended = False
        elif ended and pt not in ("EG", "EP"):
            period += 1
            ended = False
        if pt == "EP":
            ended = True
        yield period, row


def _raw_elapsed(rows: list[tuple[int, dict[str, Any]]]) -> list[int]:
    """Elapsed seconds per row from (period, remaining clock); blanks inherit."""
    out: list[int] = []
    last_period, last_remaining = 0, None
    for period, row in rows:
        play_type = (row.get("PLAYTYPE") or "").strip()
        if period != last_period:
            last_period, last_remaining = period, None
        start, length = period_start_seconds(period), period_length_seconds(period)
        remaining = parse_clock(row.get("MARKERTIME"))
        if remaining is None:
            if play_type in ("EP", "EG"):
                remaining = 0
            elif last_remaining is not None:
                remaining = last_remaining
            else:
                remaining = length
        remaining = max(0, min(length, remaining))
        last_remaining = remaining
        out.append(start + (length - remaining))
    return out


def parse_play_by_play(payload: dict[str, Any]) -> tuple[list[Event], list[str], dict[str, int]]:
    events: list[Event] = []
    warnings: list[str] = []
    unknown: dict[str, int] = {}
    rows = list(_iter_raw_events(payload))
    raw = _raw_elapsed(rows)

    # Pass 0: minute-digit typos.  Scorers (and an older feed bug that writes
    # whole-minute clocks one minute high, "09:00" for "08:00") produce a
    # group of rows stamped exactly one minute too early.  When shifting such
    # a group forward by 60s puts it between its predecessor and the next
    # differently-stamped row, apply the shift.
    tol = CLOCK_REGRESSION_TOLERANCE
    minute_fixes = 0
    i = 1
    while i < len(raw):
        per = rows[i][0]
        mt = (rows[i][1].get("MARKERTIME") or "").strip()
        if mt and rows[i - 1][0] == per and raw[i] < raw[i - 1] - tol:
            j = i
            while j < len(raw) and rows[j][0] == per and (rows[j][1].get("MARKERTIME") or "").strip() == mt:
                j += 1
            nxt = raw[j] if j < len(raw) and rows[j][0] == per else period_end_seconds(per)
            shifted = raw[i] + 60
            if raw[i - 1] - tol <= shifted <= nxt + tol and shifted <= period_end_seconds(per):
                for k in range(i, j):
                    raw[k] = shifted
                minute_fixes += 1
            i = j
            continue
        i += 1

    # Pass 1: forward spikes.  A group of rows sharing one stamp that sits
    # ahead of both the previous and the next group (e.g. "00:00" logged
    # between "00:50" and "00:49") would drag every later row forward if left
    # alone; snap the group back to its predecessor instead.
    groups: list[tuple[int, int]] = []  # [start, end) of same-period, same-stamp runs
    i = 0
    while i < len(raw):
        j = i + 1
        while j < len(raw) and rows[j][0] == rows[i][0] and raw[j] == raw[i]:
            j += 1
        groups.append((i, j))
        i = j
    spikes = 0
    for gi in range(1, len(groups) - 1):
        (ps, _), (cs, ce), (ns, _) = groups[gi - 1], groups[gi], groups[gi + 1]
        if not (rows[ps][0] == rows[cs][0] == rows[ns][0]):
            continue
        prev, cur, nxt = raw[ps], raw[cs], raw[ns]
        if cur - max(prev, nxt) > tol and nxt >= prev - tol:
            for k in range(cs, ce):
                raw[k] = prev
            spikes += ce - cs

    # Pass 2: monotonicity.  The API order is the official chronological order;
    # a row stamped earlier than its predecessor (assist logged a second before
    # its basket, or a typo) is pinned to the running maximum.
    running_max = 0
    regressions = 0
    max_regression = 0

    for seq, (period, row) in enumerate(rows):
        play_type = _text(row.get("PLAYTYPE")).strip()
        elapsed = raw[seq]
        if elapsed < running_max:
            regressions += 1
            max_regression = max(max_regression, running_max - elapsed)
            elapsed = running_max
        running_max = elapsed

        player_id = _clean(row.get("PLAYER_ID"))
        if player_id and not is_player_id(player_id):
            player_id = None  # bench / coach pseudo-ids (CO_A, CO_B, AC_...)
        stat, delta = None, 0
        classified = classify_play_type(play_type)
        if classified is not None:
            stat, delta = classified
            if not player_id:  # team rebounds / team turnovers etc.
                delta = 0
        elif play_type and play_type not in NEUTRAL_PLAY_TYPES:
            unknown[play_type] = unknown.get(play_type, 0) + 1

        events.append(
            Event(
                seq=seq,
                number_of_play=_int_or_none(row.get("NUMBEROFPLAY")),
                period=period,
                marker_time=_text(row.get("MARKERTIME")).strip(),
                elapsed_seconds=elapsed,
                play_type=play_type,
                play_info=_text(row.get("PLAYINFO")).strip(),
                player_id=player_id,
                player_name=_clean(row.get("PLAYER")),
                team_code=_clean(row.get("CODETEAM")),
                dorsal=_clean(row.get("DORSAL")),
                points_a=_int_or_none(row.get("POINTS_A")),
                points_b=_int_or_none(row.get("POINTS_B")),
                pir_delta=delta,
                stat=stat if player_id else None,
            )
        )
    # Scorers routinely stamp an assist/rebound 1-2s off its basket; only a
    # larger backwards jump suggests a data problem worth flagging.
    if minute_fixes:
        warnings.append(f"{minute_fixes} whole-minute clock stamp(s) corrected by one minute (minute-digit typo / known feed quirk)")
    if spikes:
        warnings.append(f"{spikes} event(s) stamped far ahead of both neighbouring events; snapped back")
    if max_regression > CLOCK_REGRESSION_TOLERANCE:
        warnings.append(
            f"{regressions} event(s) logged with a clock up to {max_regression}s earlier than a "
            "preceding event; pinned to the preceding time"
        )
    if unknown:
        warnings.append("Unrecognised play types: " + ", ".join(f"{k}x{v}" for k, v in sorted(unknown.items())))
    return events, warnings, unknown


def reconstruct(payload: dict[str, Any]) -> GameReconstruction:
    events, warnings, unknown = parse_play_by_play(payload)
    players: dict[str, PlayerReconstruction] = {}
    pir: dict[str, int] = {}
    for ev in events:
        if not ev.player_id:
            continue
        pr = players.get(ev.player_id)
        if pr is None:
            pr = players[ev.player_id] = PlayerReconstruction(
                ev.player_id, ev.player_name, ev.team_code, ev.dorsal
            )
        if ev.stat is None:
            continue
        pr.stats[ev.stat] = pr.stats.get(ev.stat, 0) + 1
        pir[ev.player_id] = pir.get(ev.player_id, 0) + ev.pir_delta
        pr.timeline.append(
            TimelinePoint(
                seq=ev.seq,
                elapsed_seconds=ev.elapsed_seconds,
                period=ev.period,
                marker_time=ev.marker_time,
                play_type=ev.play_type,
                play_info=ev.play_info,
                delta=ev.pir_delta,
                pir=pir[ev.player_id],
            )
        )
    max_period = max((e.period for e in events), default=0)
    if events and not any(e.play_type == "EG" for e in events) and not payload.get("Live"):
        warnings.append("No End Game marker in play-by-play")
    return GameReconstruction(
        events=events,
        players=players,
        max_period=max_period,
        is_live=bool(payload.get("Live")),
        warnings=warnings,
        unknown_play_types=unknown,
    )


# ---------------------------------------------------------------- validation

BOX_FIELDS = {
    "points": "Points",
    "rebounds": "TotalRebounds",
    "assists": "Assistances",
    "steals": "Steals",
    "blocks": "BlocksFavour",
    "blocks_against": "BlocksAgainst",
    "fouls_drawn": "FoulsReceived",
    "fouls": "FoulsCommited",
    "turnovers": "Turnovers",
}


def box_score_players(box: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for team in box.get("Stats") or []:
        for p in team.get("PlayersStats") or []:
            pid = _clean(p.get("Player_ID"))
            if pid:
                out.append(p)
    return out


def box_pir(p: dict[str, Any]) -> int | None:
    return _int_or_none(p.get("Valuation"))


def validate_against_box_score(game: GameReconstruction, box: dict[str, Any]) -> dict[str, Any]:
    """Compare reconstructed final PIR (and components) with the official box score."""
    box_players = box_score_players(box)
    if not box_players:
        return {"status": "no_boxscore", "mismatches": [], "checked": 0}
    mismatches = []
    checked = 0
    for p in box_players:
        pid = _clean(p.get("Player_ID"))
        official = box_pir(p)
        if official is None:
            continue
        checked += 1
        rec = game.players.get(pid)
        ours = rec.final_pir if rec else 0
        if ours != official:
            comp = rec.box_like() if rec else {}
            fga = (_int_or_none(p.get("FieldGoalsAttempted2")) or 0) + (_int_or_none(p.get("FieldGoalsAttempted3")) or 0)
            fgm = (_int_or_none(p.get("FieldGoalsMade2")) or 0) + (_int_or_none(p.get("FieldGoalsMade3")) or 0)
            ftm_missed = (_int_or_none(p.get("FreeThrowsAttempted")) or 0) - (_int_or_none(p.get("FreeThrowsMade")) or 0)
            diffs = {}
            for k, bk in BOX_FIELDS.items():
                bv = _int_or_none(p.get(bk)) or 0
                if comp.get(k, 0) != bv:
                    diffs[k] = {"pbp": comp.get(k, 0), "box": bv}
            if comp.get("fg_missed", 0) != fga - fgm:
                diffs["fg_missed"] = {"pbp": comp.get("fg_missed", 0), "box": fga - fgm}
            if comp.get("ft_missed", 0) != ftm_missed:
                diffs["ft_missed"] = {"pbp": comp.get("ft_missed", 0), "box": ftm_missed}
            mismatches.append({
                "player_id": pid,
                "player": _clean(p.get("Player")),
                "reconstructed": ours,
                "official": official,
                "diff": ours - official,
                "components": diffs,
            })
    status = "ok" if not mismatches else "mismatch"
    return {"status": status, "mismatches": mismatches, "checked": checked}
