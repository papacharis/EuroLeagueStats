"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorBox, Loading, SeasonSelect, useApi } from "@/components/ui";
import { api, fmtDate, fmtElapsed, parseElapsed } from "@/lib/api";

type Mode = "at" | "reached" | "drops" | "player";

interface Row {
  game_id: string;
  player_id: string;
  player_display_name: string;
  team_code: string;
  opponent_code: string;
  utc_date: string;
  season_code: string;
  home_code: string;
  away_code: string;
  home_score: number | null;
  away_score: number | null;
  final_pir: number;
  max_pir: number;
  min_pir: number;
  max_drop: number;
  validation_status: string;
  pir?: number;
  peak_in_window?: number;
  first_reached?: number;
  drop_detail?: { drop: number; from_pir: number; from_elapsed: number; to_pir: number; to_elapsed: number } | null;
}

const PRESETS: { label: string; mode: Mode; set: Partial<State> }[] = [
  { label: "PIR ≥ 20 at minute 12", mode: "at", set: { time: "12:00", minPir: "20", maxPir: "", sort: "desc" } },
  { label: "Reached PIR 25 before halftime", mode: "reached", set: { threshold: "25", from: "0:00", to: "20:00" } },
  { label: "PIR dropped by ≥ 10", mode: "drops", set: { minDrop: "10" } },
  { label: "PIR > 15 at end of Q3", mode: "at", set: { time: "30:00", minPir: "16", maxPir: "", sort: "desc" } },
  { label: "Highest PIR at minute 20", mode: "at", set: { time: "20:00", minPir: "", maxPir: "", sort: "desc" } },
  { label: "A player's PIR at minute 10, last 20 games", mode: "player", set: { time: "10:00", lastN: "20" } },
];

interface State {
  time: string;
  minPir: string;
  maxPir: string;
  sort: string;
  threshold: string;
  from: string;
  to: string;
  minDrop: string;
  season: string;
  team: string;
  opponent: string;
  player: string;
  dateFrom: string;
  dateTo: string;
  validatedOnly: boolean;
  lastN: string;
}

const INITIAL: State = {
  time: "12:00", minPir: "20", maxPir: "", sort: "desc", threshold: "25", from: "0:00", to: "20:00", minDrop: "10",
  season: "", team: "", opponent: "", player: "", dateFrom: "", dateTo: "", validatedOnly: false, lastN: "20",
};

export default function SearchPage() {
  const [mode, setMode] = useState<Mode>("at");
  const [s, setS] = useState<State>(INITIAL);
  const [results, setResults] = useState<{ total: number; results: Row[]; average?: number | null; t?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [lastRun, setLastRun] = useState<{ mode: Mode; s: State } | null>(null);
  const teams = useApi<{ code: string; name: string }[]>("/teams", { season: s.season });
  const playerOpts = useApi<{ results: { id: string; display_name: string; last_team_code: string }[] }>(
    mode === "player" && s.player.length >= 2 ? "/players" : null, { q: s.player, limit: 10 },
  );
  const [pickedPlayer, setPickedPlayer] = useState<{ id: string; name: string } | null>(null);
  const PAGE = 50;

  const upd = (patch: Partial<State>) => setS((x) => ({ ...x, ...patch }));

  async function run(m: Mode = mode, st: State = s, pg = 0) {
    setError(null);
    setBusy(true);
    setPage(pg);
    const common = {
      season: st.season, team: st.team, opponent: st.opponent,
      player: m === "player" ? undefined : st.player,
      date_from: st.dateFrom, date_to: st.dateTo, validated_only: st.validatedOnly || undefined,
      limit: PAGE, offset: pg * PAGE,
    };
    try {
      if (m === "at") {
        const t = parseElapsed(st.time);
        if (t === null) throw new Error("Enter the elapsed game time as mm:ss or minutes");
        setResults(await api("/search/at-time", { ...common, t, min_pir: st.minPir, max_pir: st.maxPir, sort: st.sort }));
      } else if (m === "reached") {
        const a = parseElapsed(st.from), b = parseElapsed(st.to);
        if (a === null || b === null) throw new Error("Enter a valid time window");
        if (!st.threshold) throw new Error("Enter a PIR threshold");
        setResults(await api("/search/reached", { ...common, threshold: st.threshold, t_from: a, t_to: b }));
      } else if (m === "drops") {
        setResults(await api("/search/drops", { ...common, min_drop: st.minDrop || 10 }));
      } else {
        const t = parseElapsed(st.time);
        if (!pickedPlayer) throw new Error("Pick a player from the suggestions");
        if (t === null) throw new Error("Enter the elapsed game time as mm:ss or minutes");
        const r = await api<{ games: Row[]; average: number | null; t: number }>(`/players/${pickedPlayer.id}/at-time`, {
          t, last: st.lastN || 20, season: st.season,
        });
        setResults({ total: r.games.length, results: r.games, average: r.average, t: r.t });
      }
      setLastRun({ mode: m, s: st });
    } catch (e: any) {
      setError(e?.message || String(e));
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tFor = (r: Row) => {
    if (lastRun?.mode === "at" || lastRun?.mode === "player") return parseElapsed(lastRun.s.time) ?? 0;
    if (lastRun?.mode === "reached") return r.first_reached ?? 0;
    if (lastRun?.mode === "drops") return r.drop_detail?.to_elapsed ?? 0;
    return 0;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Advanced PIR Search</h1>
          <div className="subtle">Every query runs on PIR reconstructed event-by-event from real play-by-play.</div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className="btn small"
            onClick={() => {
              const next = { ...s, ...p.set };
              setS(next);
              setMode(p.mode);
              if (p.mode !== "player") run(p.mode, next);
              else setResults(null);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="seg" style={{ marginBottom: 14 }} role="tablist">
          {([["at", "PIR at a moment"], ["reached", "Reached a PIR"], ["drops", "PIR drops"], ["player", "Player across games"]] as [Mode, string][]).map(([m, l]) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => { setMode(m); setResults(null); }}>{l}</button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); run(); }}>
          <div className="filters" style={{ marginBottom: 10 }}>
            {(mode === "at" || mode === "player") && (
              <div className="field">
                <label>Elapsed time</label>
                <div className="row">
                  <input type="text" value={s.time} onChange={(e) => upd({ time: e.target.value })} style={{ width: 80 }} />
                  <select value="" onChange={(e) => e.target.value && upd({ time: e.target.value })} aria-label="Quarter end">
                    <option value="">End of…</option>
                    <option value="10:00">Q1</option><option value="20:00">Q2 (half)</option><option value="30:00">Q3</option><option value="40:00">Q4</option>
                  </select>
                </div>
              </div>
            )}
            {mode === "at" && (
              <>
                <div className="field"><label>Min PIR</label><input type="number" value={s.minPir} onChange={(e) => upd({ minPir: e.target.value })} style={{ width: 90 }} /></div>
                <div className="field"><label>Max PIR</label><input type="number" value={s.maxPir} onChange={(e) => upd({ maxPir: e.target.value })} style={{ width: 90 }} /></div>
                <div className="field"><label>Sort</label>
                  <select value={s.sort} onChange={(e) => upd({ sort: e.target.value })}>
                    <option value="desc">Highest PIR</option><option value="asc">Lowest PIR</option><option value="date">Most recent</option>
                  </select>
                </div>
              </>
            )}
            {mode === "reached" && (
              <>
                <div className="field"><label>PIR ≥</label><input type="number" value={s.threshold} onChange={(e) => upd({ threshold: e.target.value })} style={{ width: 90 }} /></div>
                <div className="field"><label>From (elapsed)</label><input type="text" value={s.from} onChange={(e) => upd({ from: e.target.value })} style={{ width: 80 }} /></div>
                <div className="field"><label>To (elapsed)</label><input type="text" value={s.to} onChange={(e) => upd({ to: e.target.value })} style={{ width: 80 }} /></div>
              </>
            )}
            {mode === "drops" && (
              <div className="field"><label>Drop of at least</label><input type="number" value={s.minDrop} onChange={(e) => upd({ minDrop: e.target.value })} style={{ width: 90 }} /></div>
            )}
            {mode === "player" && (
              <>
                <div className="field" style={{ position: "relative" }}>
                  <label>Player</label>
                  <input type="search" value={pickedPlayer ? pickedPlayer.name : s.player} placeholder="Type a name…"
                    onChange={(e) => { setPickedPlayer(null); upd({ player: e.target.value }); }} style={{ width: 220 }} />
                  {!pickedPlayer && playerOpts.data && s.player.length >= 2 && (
                    <div className="card" style={{ position: "absolute", top: 62, zIndex: 10, padding: 4, width: 260 }}>
                      {playerOpts.data.results.map((p) => (
                        <div key={p.id} className="event-row" style={{ gridTemplateColumns: "1fr auto" }} onClick={() => setPickedPlayer({ id: p.id, name: p.display_name })}>
                          <span>{p.display_name}</span><span className="subtle">{p.last_team_code}</span>
                        </div>
                      ))}
                      {playerOpts.data.results.length === 0 && <div className="subtle" style={{ padding: 8 }}>No match</div>}
                    </div>
                  )}
                </div>
                <div className="field"><label>Last N games</label><input type="number" value={s.lastN} onChange={(e) => upd({ lastN: e.target.value })} style={{ width: 80 }} /></div>
              </>
            )}
          </div>
          <div className="filters" style={{ marginBottom: 0 }}>
            <div className="field"><label>Season</label><SeasonSelect value={s.season} onChange={(v) => upd({ season: v })} includeAll /></div>
            {mode !== "player" && (
              <>
                <div className="field"><label>Team</label>
                  <select value={s.team} onChange={(e) => upd({ team: e.target.value })}>
                    <option value="">Any</option>{(teams.data || []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                  </select>
                </div>
                <div className="field"><label>Opponent</label>
                  <select value={s.opponent} onChange={(e) => upd({ opponent: e.target.value })}>
                    <option value="">Any</option>{(teams.data || []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                  </select>
                </div>
                <div className="field"><label>Player name</label><input type="search" value={s.player} onChange={(e) => upd({ player: e.target.value })} style={{ width: 160 }} /></div>
                <div className="field"><label>From date</label><input type="date" value={s.dateFrom} onChange={(e) => upd({ dateFrom: e.target.value })} /></div>
                <div className="field"><label>To date</label><input type="date" value={s.dateTo} onChange={(e) => upd({ dateTo: e.target.value })} /></div>
                <label className="row subtle" style={{ fontSize: 12, alignSelf: "center" }}>
                  <input type="checkbox" checked={s.validatedOnly} onChange={(e) => upd({ validatedOnly: e.target.checked })} /> Box-score verified games only
                </label>
              </>
            )}
            <button className="btn primary" type="submit" disabled={busy} style={{ alignSelf: "flex-end" }}>{busy ? "Searching…" : "Search"}</button>
          </div>
        </form>
      </div>

      <ErrorBox error={error} />
      {busy && !results && <Loading h={240} />}
      {results && lastRun && (
        <div className="card">
          <div className="card-head">
            <h2>{results.total.toLocaleString()} result{results.total === 1 ? "" : "s"}</h2>
            {results.average !== undefined && <span className="secondary">Average PIR at {fmtElapsed(results.t || 0)}: <b className="pir">{results.average ?? "—"}</b></span>}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Player</th><th>Date</th><th>Game</th>
                  {(lastRun.mode === "at" || lastRun.mode === "player") && <th className="num">PIR at {lastRun.s.time}</th>}
                  {lastRun.mode === "reached" && <><th className="num">First reached</th><th className="num">Peak in window</th></>}
                  {lastRun.mode === "drops" && <><th className="num">Drop</th><th>From → to</th></>}
                  <th className="num">Final</th><th className="num">High</th><th className="num">Low</th>
                </tr>
              </thead>
              <tbody>
                {results.results.map((r) => (
                  <tr key={r.game_id + r.player_id}>
                    <td><Link href={`/players/${r.player_id}`}><b>{r.player_display_name}</b></Link> <span className="subtle">{r.team_code}</span></td>
                    <td className="subtle">{fmtDate(r.utc_date)}</td>
                    <td><Link href={`/games/${r.game_id}?t=${tFor(r)}&players=${r.player_id}`}>vs {r.opponent_code} <span className="subtle">{r.home_code} {r.home_score}-{r.away_score} {r.away_code}</span></Link></td>
                    {(lastRun.mode === "at" || lastRun.mode === "player") && <td className="num pir">{r.pir}</td>}
                    {lastRun.mode === "reached" && <><td className="num">{fmtElapsed(r.first_reached ?? 0)}</td><td className="num pir">{r.peak_in_window}</td></>}
                    {lastRun.mode === "drops" && (
                      <>
                        <td className="num pir delta-neg">−{r.max_drop}</td>
                        <td className="subtle">{r.drop_detail ? `${r.drop_detail.from_pir} @ ${fmtElapsed(r.drop_detail.from_elapsed)} → ${r.drop_detail.to_pir} @ ${fmtElapsed(r.drop_detail.to_elapsed)}` : "—"}</td>
                      </>
                    )}
                    <td className="num">{r.final_pir}</td>
                    <td className="num subtle">{r.max_pir}</td>
                    <td className="num subtle">{r.min_pir}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lastRun.mode !== "player" && results.total > PAGE && (
            <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
              <button className="btn small" disabled={page === 0 || busy} onClick={() => run(lastRun.mode, lastRun.s, page - 1)}>← Prev</button>
              <span className="subtle">Page {page + 1} / {Math.ceil(results.total / PAGE)}</span>
              <button className="btn small" disabled={(page + 1) * PAGE >= results.total || busy} onClick={() => run(lastRun.mode, lastRun.s, page + 1)}>Next →</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
