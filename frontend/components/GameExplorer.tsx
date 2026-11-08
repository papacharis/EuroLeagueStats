"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import PirChart, { Series } from "@/components/PirChart";
import { Crest, ErrorBox, Loading, StatusBadge, useApi, ValidationBadge } from "@/components/ui";
import {
  fmtAgo,
  fmtDate,
  fmtElapsed,
  fmtGameClock,
  GameDetail,
  GamePlayer,
  parseElapsed,
  periodEnd,
  periodStart,
  pirAt,
  SERIES_COLORS,
  signed,
  TimelinePoint,
} from "@/lib/api";

interface Props {
  gameId: string;
  initialPlayers?: string[];
  initialT?: number | null;
  syncUrl?: boolean;
}

const LIVE_POLL_MS = 5000;

export default function GameExplorer({ gameId, initialPlayers, initialT, syncUrl = true }: Props) {
  const [isLive, setIsLive] = useState(false);
  const detail = useApi<GameDetail>(`/games/${gameId}`, undefined, isLive ? LIVE_POLL_MS : undefined);
  const tl = useApi<{ timelines: Record<string, TimelinePoint[]> }>(`/games/${gameId}/timeline`, undefined, isLive ? LIVE_POLL_MS : undefined);
  const game = detail.data;
  const timelines = tl.data?.timelines || {};

  useEffect(() => setIsLive(game?.status === "live"), [game?.status]);

  const [selected, setSelected] = useState<string[]>(initialPlayers || []);
  const [t, setT] = useState<number | null>(initialT ?? null);
  const [view, setView] = useState<number | "full">("full");
  const [followLive, setFollowLive] = useState(true);
  const [timeInput, setTimeInput] = useState("");
  const [xMode, setXMode] = useState<"elapsed" | "clock">("elapsed");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const logRef = useRef<HTMLDivElement>(null);

  const endSeconds = game ? (game.status === "live" ? Math.max(game.last_event_elapsed || 0, 1) : game.game_end_seconds) : 2400;
  const fullEnd = game ? Math.max(game.game_end_seconds, endSeconds) : 2400;

  // default selection: best final PIR of each team
  useEffect(() => {
    if (!game || selected.length) return;
    const played = game.players.filter((p) => p.played);
    const best = (code: string) => played.filter((p) => p.team_code === code).sort((a, b) => b.final_pir - a.final_pir)[0];
    const picks = [best(game.home_code), best(game.away_code)].filter(Boolean).map((p) => p!.player_id);
    if (picks.length) setSelected(picks);
  }, [game, selected.length]);

  useEffect(() => {
    if (!game) return;
    if (t === null) setT(game.status === "live" ? endSeconds : game.game_end_seconds);
    else if (game.status === "live" && followLive) setT(endSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, endSeconds]);

  useEffect(() => {
    if (t !== null) setTimeInput(fmtElapsed(t));
  }, [t]);

  // keep URL shareable
  useEffect(() => {
    if (!syncUrl || t === null) return;
    const u = new URL(window.location.href);
    u.searchParams.set("t", String(t));
    if (selected.length) u.searchParams.set("players", selected.join(","));
    window.history.replaceState(null, "", u.toString());
  }, [t, selected, syncUrl]);

  const playersById = useMemo(() => {
    const m: Record<string, GamePlayer> = {};
    for (const p of game?.players || []) m[p.player_id] = p;
    return m;
  }, [game]);

  // Color follows the player (stable across selection changes).
  const colorFor = useMemo(() => {
    const m: Record<string, string> = {};
    selected.forEach((id, i) => (m[id] = SERIES_COLORS[i % SERIES_COLORS.length]));
    return m;
  }, [selected]);

  const series: Series[] = selected
    .filter((id) => playersById[id])
    .map((id) => ({ id, name: playersById[id].display_name, color: colorFor[id], timeline: timelines[id] || [] }));

  // Keep the event at the selected moment visible in the log (scroll only the log).
  useEffect(() => {
    const box = logRef.current;
    const row = box?.querySelector<HTMLElement>(".event-row.current");
    if (box && row) box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2;
  }, [t, selected[0], tl.data]);

  if (detail.error && !game) return <ErrorBox error={detail.error} />;
  if (!game) return <Loading h={420} />;

  const range: [number, number] = view === "full" ? [0, fullEnd] : [periodStart(view), periodEnd(view)];
  const cur = t ?? fullEnd;
  const focus = selected[0];
  const focusTl = focus ? timelines[focus] || [] : [];
  const imported = !!game.pbp_imported_at;

  const setTime = (v: number) => {
    const clamped = Math.max(0, Math.min(fullEnd, Math.round(v)));
    setT(clamped);
    if (game.status === "live") setFollowLive(clamped >= endSeconds);
  };

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 8 ? s : [...s, id]));
  const focusOn = (id: string) => setSelected((s) => [id, ...s.filter((x) => x !== id)]);

  const roster = game.players
    .filter((p) => p.played)
    .filter((p) => teamFilter === "all" || p.team_code === teamFilter)
    .map((p) => ({ ...p, now: pirAt(timelines[p.player_id], cur) }))
    .sort((a, b) => b.now - a.now);

  const teamName = (code: string) => (code === game.home_code ? game.home_name : code === game.away_code ? game.away_name : code);

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* ---------------------------------------------------------- header */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", gap: 16 }}>
          <div>
            <div className="subtle" style={{ fontSize: 12 }}>
              {game.season_code} · {game.phase} · {game.round_name || `Round ${game.round}`} · {fmtDate(game.utc_date, true)}
            </div>
            <div className="row" style={{ gap: 14, marginTop: 6 }}>
              <span className="team-label"><Crest src={game.home_crest} alt="" /><h1>{game.home_name}</h1></span>
              <span className="scoreline">{game.home_score ?? "–"} : {game.away_score ?? "–"}</span>
              <span className="team-label"><h1>{game.away_name}</h1><Crest src={game.away_crest} alt="" /></span>
            </div>
          </div>
          <div className="row" style={{ flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <StatusBadge game={game} />
            {imported && <ValidationBadge status={game.validation_status} />}
            {game.status === "live" && (
              <span className="subtle" style={{ fontSize: 12 }}>
                {game.current_period ? `Q${game.current_period}` : ""} {game.current_clock} · updated {fmtAgo(game.last_live_update)}
              </span>
            )}
          </div>
        </div>
        {game.status === "live" && game.live_stale && (
          <div className="alert warn" style={{ marginTop: 12 }}>
            Live data is delayed: the last successful update was {fmtAgo(game.last_live_update)}.
            {game.last_error ? ` Last error: ${game.last_error}` : ""}
          </div>
        )}
        {!imported && (
          <div className="alert warn" style={{ marginTop: 12 }}>
            {game.status === "scheduled"
              ? "This game has not started yet. Its PIR timeline will appear once play-by-play data is available."
              : game.last_error
              ? `Play-by-play could not be imported: ${game.last_error}`
              : "Play-by-play for this game has not been imported yet."}
          </div>
        )}
        {game.validation?.mismatches?.length ? (
          <details style={{ marginTop: 10 }}>
            <summary className="subtle" style={{ cursor: "pointer" }}>
              {game.validation.mismatches.length} player(s) differ from the official box score
            </summary>
            <ul>
              {game.validation.mismatches.map((m) => (
                <li key={m.player_id}>{m.player}: reconstructed {m.reconstructed}, official {m.official} ({signed(m.diff)})</li>
              ))}
            </ul>
          </details>
        ) : null}
        {game.warnings && game.warnings.length > 0 && (
          <details style={{ marginTop: 6 }}>
            <summary className="subtle" style={{ cursor: "pointer", fontSize: 12 }}>Data notes ({game.warnings.length})</summary>
            <ul className="subtle" style={{ fontSize: 12 }}>{game.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        )}
      </div>

      {imported && (
        <div className="explorer">
          {/* ------------------------------------------------------ chart */}
          <div className="grid" style={{ gap: 16 }}>
            <div className="card">
              <div className="card-head">
                <h2>PIR timeline</h2>
                <div className="row">
                  <div className="seg" role="group" aria-label="Period view">
                    <button className={view === "full" ? "active" : ""} onClick={() => setView("full")}>Full game</button>
                    {game.periods.map((p) => (
                      <button key={p.period} className={view === p.period ? "active" : ""} onClick={() => { setView(p.period); if (cur < p.start || cur > p.end) setTime(p.end); }}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="seg" role="group" aria-label="X axis">
                    <button className={xMode === "elapsed" ? "active" : ""} onClick={() => setXMode("elapsed")} title="Elapsed game time">Elapsed</button>
                    <button className={xMode === "clock" ? "active" : ""} onClick={() => setXMode("clock")} title="Quarter and game clock">Clock</button>
                  </div>
                </div>
              </div>

              {series.length > 0 && (
                <div className="legend" style={{ marginBottom: 6 }}>
                  {series.map((s) => (
                    <span key={s.id} className="player-chip">
                      <span className="dot" style={{ background: s.color }} />
                      {s.name} <b className="pir">{pirAt(s.timeline, cur)}</b>
                      <button onClick={() => toggle(s.id)} aria-label={`Remove ${s.name}`}>×</button>
                    </span>
                  ))}
                </div>
              )}
              {series.length === 0 ? (
                <div className="muted-box">Select one or more players from the list to plot their PIR.</div>
              ) : (
                <PirChart series={series} range={range} periods={game.periods} cursor={cur} onSelectTime={setTime} xMode={xMode} />
              )}

              {/* ---------------------------------------------------- slider */}
              <div style={{ marginTop: 12 }}>
                <input
                  type="range"
                  min={range[0]}
                  max={range[1]}
                  step={1}
                  value={Math.max(range[0], Math.min(range[1], cur))}
                  onChange={(e) => setTime(Number(e.target.value))}
                  aria-label="Game moment"
                />
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="row">
                    <button className="btn small" onClick={() => setTime(cur - 60)}>−1m</button>
                    <button className="btn small" onClick={() => setTime(cur - 10)}>−10s</button>
                    <button className="btn small" onClick={() => setTime(cur - 1)}>−1s</button>
                    <button className="btn small" onClick={() => setTime(cur + 1)}>+1s</button>
                    <button className="btn small" onClick={() => setTime(cur + 10)}>+10s</button>
                    <button className="btn small" onClick={() => setTime(cur + 60)}>+1m</button>
                  </div>
                  <form
                    className="row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const v = parseElapsed(timeInput);
                      if (v !== null) setTime(v);
                    }}
                  >
                    <label className="subtle" htmlFor="tin" style={{ fontSize: 12 }}>Go to elapsed (mm:ss or minute)</label>
                    <input id="tin" type="text" value={timeInput} onChange={(e) => setTimeInput(e.target.value)} style={{ width: 80 }} />
                    <button className="btn small primary" type="submit">Go</button>
                    {game.status === "live" && (
                      <button type="button" className={`btn small ${followLive ? "active" : ""}`} onClick={() => { setFollowLive(true); setT(endSeconds); }}>
                        Follow live
                      </button>
                    )}
                  </form>
                </div>
              </div>
            </div>

            {/* ------------------------------------------------- moment */}
            {focus && playersById[focus] && (
              <div className="card">
                <div className="moment">
                  <div>
                    <div className="subtle" style={{ fontSize: 12 }}>
                      <span className="dot" style={{ background: colorFor[focus], marginRight: 6 }} />
                      <Link href={`/players/${focus}`}>{playersById[focus].display_name}</Link> · {teamName(playersById[focus].team_code)}
                    </div>
                    <div className="big">PIR {pirAt(focusTl, cur)}</div>
                  </div>
                  <div>
                    <div className="subtle" style={{ fontSize: 12 }}>at elapsed</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtElapsed(cur)}</div>
                  </div>
                  <div>
                    <div className="subtle" style={{ fontSize: 12 }}>game clock</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtGameClock(cur)}</div>
                  </div>
                  <div className="subtle" style={{ fontSize: 12, marginLeft: "auto", textAlign: "right" }}>
                    Final {playersById[focus].final_pir}
                    {playersById[focus].official_pir !== null && <> · official {playersById[focus].official_pir}</>}
                    <br />Peak {playersById[focus].max_pir} at {fmtElapsed(playersById[focus].max_pir_elapsed)} · Low {playersById[focus].min_pir}
                  </div>
                </div>
                <p className="subtle" style={{ fontSize: 12, margin: "8px 2px 0" }}>
                  Cumulative PIR after every play-by-play event recorded up to {fmtElapsed(cur)} of elapsed game time.
                </p>

                <h3 style={{ margin: "14px 0 6px" }}>Event log: how each event moved PIR</h3>
                <div className="event-list" ref={logRef}>
                  {focusTl.length === 0 && <div className="muted-box">No PIR events for this player.</div>}
                  {focusTl.map((e, i) => {
                    const future = e.elapsed_seconds > cur;
                    const isCurrent = !future && (i === focusTl.length - 1 || focusTl[i + 1].elapsed_seconds > cur);
                    return (
                      <div
                        key={e.seq}
                        className={`event-row ${future ? "future" : ""} ${isCurrent ? "current" : ""}`}
                        onClick={() => setTime(e.elapsed_seconds)}
                        title="Jump to this moment"
                      >
                        <span className="subtle">{fmtElapsed(e.elapsed_seconds)}<br /><span style={{ fontSize: 11 }}>{fmtGameClock(e.elapsed_seconds)}</span></span>
                        <span>{e.play_info || e.play_type}</span>
                        <span className={e.delta > 0 ? "delta-pos" : "delta-neg"} style={{ textAlign: "right" }}>{signed(e.delta)}</span>
                        <span className="pir" style={{ textAlign: "right" }}>{e.pir}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ------------------------------------------------------ roster */}
          <div className="card" style={{ position: "sticky", top: 72 }}>
            <div className="card-head">
              <h2>PIR at {fmtElapsed(cur)}</h2>
              <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} aria-label="Team">
                <option value="all">Both teams</option>
                <option value={game.home_code}>{game.home_name}</option>
                <option value={game.away_code}>{game.away_name}</option>
              </select>
            </div>
            <p className="subtle" style={{ fontSize: 12, marginTop: -6 }}>Tick to compare (up to 8). Click a name to focus.</p>
            <div className="table-wrap" style={{ maxHeight: 640, overflowY: "auto" }}>
              <table className="roster">
                <thead>
                  <tr><th></th><th>Player</th><th className="num">Now</th><th className="num">Final</th></tr>
                </thead>
                <tbody>
                  {roster.map((p) => (
                    <tr key={p.player_id} className={p.player_id === focus ? "selected" : ""}>
                      <td style={{ width: 28 }}>
                        <input type="checkbox" checked={selected.includes(p.player_id)} onChange={() => toggle(p.player_id)} aria-label={`Compare ${p.display_name}`} />
                      </td>
                      <td style={{ cursor: "pointer" }} onClick={() => focusOn(p.player_id)}>
                        {selected.includes(p.player_id) && <span className="dot" style={{ background: colorFor[p.player_id], marginRight: 6 }} />}
                        {p.display_name}
                        <span className="subtle" style={{ fontSize: 11, marginLeft: 6 }}>{p.team_code}</span>
                      </td>
                      <td className="num pir">{p.now}</td>
                      <td className="num subtle" title={p.validated === false ? `Official: ${p.official_pir}` : "Matches official box score"}>
                        {p.final_pir}{p.validated === false && <span className="delta-neg"> ≠{p.official_pir}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {tl.error && <ErrorBox error={tl.error} />}
    </div>
  );
}
