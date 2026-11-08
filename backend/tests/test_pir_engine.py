import json
from pathlib import Path

from app.pir_engine import (
    classify_play_type,
    game_clock_for_elapsed,
    parse_play_by_play,
    period_start_seconds,
    reconstruct,
    validate_against_box_score,
)

FIX = Path(__file__).parent / "fixtures"


def row(pt, player="P1", clock="09:00", team="AAA", info=None, minute=1):
    return {
        "PLAYTYPE": pt, "PLAYER_ID": player, "PLAYER": "DOE, JOHN" if player else None,
        "CODETEAM": team, "MARKERTIME": clock, "PLAYINFO": info or pt, "MINUTE": minute,
        "NUMBEROFPLAY": 1, "DORSAL": "1", "POINTS_A": None, "POINTS_B": None,
    }


def payload(q1=(), q2=(), q3=(), q4=(), ot=(), live=False):
    return {"Live": live, "FirstQuarter": list(q1), "SecondQuarter": list(q2), "ThirdQuarter": list(q3),
            "ForthQuarter": list(q4), "ExtraTime": list(ot)}


# ------------------------------------------------------------------ formula

def test_pir_formula_every_component():
    rows = [
        row("2FGM", clock="09:50"), row("3FGM", clock="09:40"), row("FTM", clock="09:30"),
        row("O", clock="09:20"), row("D", clock="09:10"), row("AS", clock="09:00"),
        row("ST", clock="08:50"), row("FV", clock="08:40"), row("RV", clock="08:30"),
        row("2FGA", clock="08:20"), row("3FGA", clock="08:10"), row("FTA", clock="08:00"),
        row("TO", clock="07:50"), row("AG", clock="07:40"), row("CM", clock="07:30"),
    ]
    rec = reconstruct(payload(q1=rows + [row("EG", player=None, clock="")]))
    p = rec.players["P1"]
    # +2 +3 +1 +1 +1 +1 +1 +1 +1 = 12 ; -1 x 6 = -6
    assert p.final_pir == 6
    assert [t.pir for t in p.timeline] == [2, 5, 6, 7, 8, 9, 10, 11, 12, 11, 10, 9, 8, 7, 6]


def test_pir_can_go_negative_and_team_rows_are_ignored():
    rows = [row("TO", clock="09:00"), row("CM", clock="08:00"), row("D", player="", clock="07:00"),
            row("TO", player=None, clock="06:00")]
    rec = reconstruct(payload(q1=rows))
    assert rec.players["P1"].final_pir == -2
    assert set(rec.players) == {"P1"}


def test_new_and_legacy_play_type_codes():
    for code in ("CMT1", "CMU_DI", "CMU_FL", "CMU", "CMT", "CMD", "OF"):
        assert classify_play_type(code) == ("foul", -1), code
    assert classify_play_type("DUNK") == ("fg2_made", 2)
    assert classify_play_type("LAYUPMD") == ("fg2_made", 2)
    assert classify_play_type("LAYUPATT")[1] == -1
    assert classify_play_type("2FGAB")[1] == -1
    for neutral in ("IN", "OUT", "TOUT", "BP", "EP", "EG", "JB", "CCH"):
        assert classify_play_type(neutral) is None


# ------------------------------------------------------------------ time

def test_elapsed_time_across_quarters_and_overtimes():
    assert period_start_seconds(1) == 0
    assert period_start_seconds(3) == 1200
    assert period_start_seconds(5) == 2400
    assert period_start_seconds(6) == 2700
    assert game_clock_for_elapsed(720) == (2, "08:00")
    assert game_clock_for_elapsed(2550) == (5, "02:30")


def test_overtime_periods_with_and_without_begin_period_rows():
    ot = [row("BP", player=None, clock=""), row("2FGM", clock="04:00", minute=42),
          row("EP", player=None, clock=""),
          # second OT, feed omitted its BP row
          row("2FGM", clock="03:00", minute=48), row("EG", player=None, clock="")]
    events, _, _ = parse_play_by_play(payload(ot=ot))
    scored = [e for e in events if e.play_type == "2FGM"]
    assert [e.period for e in scored] == [5, 6]
    assert [e.elapsed_seconds for e in scored] == [2400 + 60, 2700 + 120]


def test_minute_digit_typo_is_corrected():
    q = [row("2FGM", clock="08:03"), row("3FGM", clock="09:00"), row("AS", clock="07:57")]
    events, warnings, _ = parse_play_by_play(payload(q1=q))
    assert [e.elapsed_seconds for e in events] == [117, 120, 123]
    assert any("one minute" in w for w in warnings)


def test_forward_spike_group_is_snapped_back():
    q = [row("2FGM", clock="02:10"), row("FV", clock="01:00"), row("AG", player="P2", clock="01:00"),
         row("O", clock="01:59"), row("2FGM", clock="01:51")]
    events, _, _ = parse_play_by_play(payload(q1=q))
    els = [e.elapsed_seconds for e in events]
    assert els == sorted(els)
    assert els[1] == 470  # snapped to its predecessor, not 540
    assert els[3] == 481


def test_elapsed_is_monotonic_and_order_preserved_for_identical_timestamps():
    q = [row("2FGM", clock="05:04"), row("AS", player="P2", clock="05:05"), row("FTM", clock="05:04")]
    events, _, _ = parse_play_by_play(payload(q1=q))
    assert [e.seq for e in events] == [0, 1, 2]
    assert [e.elapsed_seconds for e in events] == [296, 296, 296]


def test_pir_at_time_uses_all_events_up_to_t():
    q = [row("2FGM", clock="09:00"), row("TO", clock="09:00"), row("3FGM", clock="05:00")]
    p = reconstruct(payload(q1=q)).players["P1"]
    assert p.pir_at(59) == 0
    assert p.pir_at(60) == 1  # both events at 1:00 elapsed applied
    assert p.pir_at(299) == 1
    assert p.pir_at(300) == 4
    s = p.summary()
    assert s["max_pir"] == 4 and s["max_drop"] == 1


def test_nul_bytes_are_stripped():
    q = [row("2FGM", clock="09:00", info="Two\x00 Pointer")]
    events, _, _ = parse_play_by_play(payload(q1=q))
    assert "\x00" not in events[0].play_info


# ------------------------------------------------------------------ real data

def _load(name):
    return json.loads((FIX / name).read_text())


def test_real_game_matches_official_box_score():
    rec = reconstruct(_load("pbp_E2025_1.json"))
    v = validate_against_box_score(rec, _load("box_E2025_1.json"))
    assert v["status"] == "ok", v["mismatches"]
    assert v["checked"] >= 20
    larkin = rec.players["P007200"]
    assert larkin.final_pir == 12
    # values verified against the reconstruction at each checkpoint
    assert [larkin.pir_at(m * 60) for m in (5, 10, 20, 30, 40)] == [2, -1, 6, 9, 12]


def test_real_double_overtime_game_without_begin_period_rows():
    rec = reconstruct(_load("pbp_E2010_12.json"))
    assert rec.max_period == 6
    v = validate_against_box_score(rec, _load("box_E2010_12.json"))
    assert v["status"] == "ok", v["mismatches"]
    els = [e.elapsed_seconds for e in rec.events]
    assert els == sorted(els)
    assert els[-1] == 3000  # end of OT2
