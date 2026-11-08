"use client";
import { useEffect, useState } from "react";
import { ErrorBox, GameRow, Loading, SeasonSelect, useApi } from "@/components/ui";
import { Game } from "@/lib/api";

export default function GamesPage() {
  const seasons = useApi<{ code: string; games_imported: number }[]>("/seasons");
  const [season, setSeason] = useState("");
  const [team, setTeam] = useState("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [status, setStatus] = useState("final,live");
  const [page, setPage] = useState(0);
  const PAGE = 50;

  useEffect(() => {
    if (!season && seasons.data?.length) {
      const fromUrl = new URLSearchParams(window.location.search).get("season");
      if (fromUrl && seasons.data.some((s) => s.code === fromUrl)) return setSeason(fromUrl);
      const withData = seasons.data.find((s) => s.games_imported > 0) || seasons.data[0];
      setSeason(withData.code);
    }
  }, [seasons.data, season]);
  useEffect(() => {
    const id = setTimeout(() => setQDebounced(q), 250);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPage(0), [season, team, qDebounced, status]);

  const teams = useApi<{ code: string; name: string }[]>(season ? "/teams" : null, { season });
  const games = useApi<{ total: number; results: Game[] }>(season ? "/games" : null, {
    season, team, q: qDebounced, status, limit: PAGE, offset: page * PAGE,
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Historical Games</h1>
          <div className="subtle">Pick a match to explore every player&apos;s PIR at any moment.</div>
        </div>
      </div>
      <div className="filters">
        <div className="field"><label>Season</label><SeasonSelect value={season} onChange={setSeason} /></div>
        <div className="field">
          <label>Team</label>
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {(teams.data || []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="final,live">Played</option>
            <option value="live">Live</option>
            <option value="scheduled">Upcoming</option>
            <option value="postponed">Postponed</option>
            <option value="no_data">No play-by-play</option>
            <option value="">All</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 180 }}>
          <label>Search</label>
          <input type="search" placeholder="Team name or code…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <ErrorBox error={seasons.error || games.error} />
      <div className="card">
        {games.loading && !games.data ? <Loading h={300} /> : null}
        {games.data && (
          <>
            <div className="subtle" style={{ marginBottom: 8 }}>{games.data.total} games</div>
            {games.data.results.length === 0 && (
              <div className="muted-box">No games match. If this season has not been imported yet, run the importer (see README).</div>
            )}
            {games.data.results.map((g) => <GameRow key={g.id} g={g} />)}
            <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
              <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
              <span className="subtle">Page {page + 1} / {Math.max(1, Math.ceil(games.data.total / PAGE))}</span>
              <button className="btn small" disabled={(page + 1) * PAGE >= games.data.total} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
