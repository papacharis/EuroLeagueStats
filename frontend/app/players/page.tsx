"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorBox, Loading, SeasonSelect, useApi } from "@/components/ui";

interface PlayerRow {
  id: string;
  display_name: string;
  last_team_code: string | null;
  last_team_name: string | null;
  games: number;
  avg_pir: number | null;
  best_pir: number | null;
}

export default function PlayersPage() {
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [season, setSeason] = useState("");
  const [team, setTeam] = useState("");
  const [page, setPage] = useState(0);
  const PAGE = 50;
  useEffect(() => {
    const id = setTimeout(() => setQd(q), 250);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPage(0), [qd, season, team]);
  const teams = useApi<{ code: string; name: string }[]>("/teams", { season });
  const res = useApi<{ total: number; results: PlayerRow[] }>("/players", { q: qd, season, team, limit: PAGE, offset: page * PAGE });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Players</h1>
          <div className="subtle">Every player with reconstructed play-by-play PIR.</div>
        </div>
      </div>
      <div className="filters">
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label>Search</label>
          <input type="search" autoFocus placeholder="Player name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field"><label>Season</label><SeasonSelect value={season} onChange={setSeason} includeAll /></div>
        <div className="field">
          <label>Team</label>
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {(teams.data || []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <ErrorBox error={res.error} />
      <div className="card">
        {!res.data ? <Loading h={300} /> : (
          <>
            <div className="subtle" style={{ marginBottom: 8 }}>{res.data.total} players</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Player</th><th>Latest team</th><th className="num">Games</th><th className="num">Avg PIR</th><th className="num">Best PIR</th></tr></thead>
                <tbody>
                  {res.data.results.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={`/players/${p.id}${season ? `?season=${season}` : ""}`}><b>{p.display_name}</b></Link></td>
                      <td className="secondary">{p.last_team_name || p.last_team_code || "—"}</td>
                      <td className="num">{p.games}</td>
                      <td className="num pir">{p.avg_pir ?? "—"}</td>
                      <td className="num">{p.best_pir ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
              <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
              <span className="subtle">Page {page + 1} / {Math.max(1, Math.ceil(res.data.total / PAGE))}</span>
              <button className="btn small" disabled={(page + 1) * PAGE >= res.data.total} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
