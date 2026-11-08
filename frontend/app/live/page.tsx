"use client";
import { useEffect, useState } from "react";
import GameExplorer from "@/components/GameExplorer";
import { ErrorBox, GameRow, Loading, StatusBadge, useApi } from "@/components/ui";
import { fmtAgo, fmtDate, Game } from "@/lib/api";

interface LiveResp {
  now: string;
  poll_interval: number;
  stale_after: number;
  poller: { heartbeat: string; alive: boolean; errors?: { id?: string; error: string }[] } | null;
  live: Game[];
  upcoming: Game[];
  recent: Game[];
}

export default function LivePage() {
  const live = useApi<LiveResp>("/live", undefined, 5000);
  const [selected, setSelected] = useState<string | null>(null);
  const games = live.data?.live || [];

  useEffect(() => {
    if (games.length && (!selected || !games.some((g) => g.id === selected))) setSelected(games[0].id);
  }, [games, selected]);

  const poller = live.data?.poller;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Live Games</h1>
          <div className="subtle">PIR recomputed from the live play-by-play feed with the same engine as historical games.</div>
        </div>
        <div className="row">
          {live.error ? (
            <span className="badge bad">API unreachable</span>
          ) : poller ? (
            poller.alive ? (
              <span className="badge good" title={`Last poller cycle ${fmtAgo(poller.heartbeat)}`}>● Live poller running · {fmtAgo(poller.heartbeat)}</span>
            ) : (
              <span className="badge bad" title="The background worker is not polling">Live poller stopped · last seen {fmtAgo(poller.heartbeat)}</span>
            )
          ) : (
            <span className="badge warn">Live poller has never run</span>
          )}
        </div>
      </div>
      <ErrorBox error={live.error} />
      {poller && !poller.alive && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          Live data is unavailable: the background worker is not running (start it with <code>python -m app.cli worker</code>).
          Scores and PIR shown below may be out of date.
        </div>
      )}
      {poller?.errors && poller.errors.length > 0 && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          The data source returned errors on the last poll: {poller.errors.map((e) => `${e.id || ""} ${e.error}`).join("; ")}
        </div>
      )}

      {!live.data && !live.error && <Loading h={200} />}

      {live.data && games.length === 0 && (
        <div className="grid grid-2">
          <div className="card">
            <h2 style={{ marginBottom: 8 }}>No EuroLeague game is live right now</h2>
            <p className="subtle">
              The worker checks the schedule every few minutes and starts polling the play-by-play feed every{" "}
              {live.data.poll_interval}s as soon as a game tips off. This page refreshes automatically.
            </p>
            <h3 style={{ margin: "16px 0 6px" }}>Next games</h3>
            {live.data.upcoming.length === 0 && <div className="subtle">No upcoming games in the database.</div>}
            {live.data.upcoming.map((g) => (
              <div key={g.id} className="list-game">
                <div className="subtle" style={{ fontSize: 12 }}>{fmtDate(g.utc_date, true)}</div>
                <div>{g.home_name} vs {g.away_name}</div>
                <StatusBadge game={g} />
              </div>
            ))}
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 8 }}>Latest finished games</h2>
            {live.data.recent.map((g) => <GameRow key={g.id} g={g} />)}
          </div>
        </div>
      )}

      {games.length > 0 && (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            {games.map((g) => (
              <button key={g.id} className={`btn ${selected === g.id ? "active" : ""}`} onClick={() => setSelected(g.id)}>
                <span className="dot pulse" style={{ background: g.live_stale ? "var(--warn)" : "var(--live)", marginRight: 6 }} />
                {g.home_code} {g.home_score ?? 0} – {g.away_score ?? 0} {g.away_code}
                <span className="subtle" style={{ marginLeft: 6 }}>
                  {g.current_period ? (g.current_period <= 4 ? `Q${g.current_period}` : `OT${g.current_period - 4}`) : ""} {g.current_clock}
                </span>
              </button>
            ))}
          </div>
          {selected && <GameExplorer key={selected} gameId={selected} syncUrl={false} />}
        </>
      )}
    </>
  );
}
