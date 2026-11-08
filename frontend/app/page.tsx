"use client";
import Link from "next/link";
import { ErrorBox, GameRow, Loading, useApi } from "@/components/ui";
import { fmtAgo, Game, Season } from "@/lib/api";

interface Status {
  counts: { seasons: number; games_total: number; games_imported: number; players: number; timeline_points: number };
  validation: Record<string, number>;
  sync: Record<string, { value: any; updated_at: string }>;
}

interface AtTimeRow {
  game_id: string;
  player_id: string;
  player_display_name: string;
  team_code: string;
  opponent_code: string;
  pir: number;
  final_pir: number;
  utc_date: string;
  season_code: string;
}

export default function Dashboard() {
  const status = useApi<Status>("/status", undefined, 30000);
  const seasons = useApi<Season[]>("/seasons");
  const live = useApi<{ live: Game[]; recent: Game[]; upcoming: Game[] }>("/live", undefined, 15000);
  const current = seasons.data?.find((s) => s.games_imported > 0)?.code;
  const top20 = useApi<{ results: AtTimeRow[] }>(current ? "/search/at-time" : null, { minute: 20, season: current, limit: 8 });
  const topFinal = useApi<{ results: AtTimeRow[] }>(current ? "/search/at-time" : null, { quarter: 4, season: current, limit: 8 });

  const c = status.data?.counts;
  const v = status.data?.validation || {};
  const verifiedPct = c && c.games_imported ? Math.round(((v.ok || 0) / c.games_imported) * 1000) / 10 : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="subtle">Every player&apos;s PIR at every moment, rebuilt from official EuroLeague play-by-play.</div>
        </div>
        <Link href="/games" className="btn primary">Explore a game →</Link>
      </div>
      <ErrorBox error={status.error} />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat-tile">
          <div className="label">Games imported</div>
          <div className="value">{c ? c.games_imported.toLocaleString() : "—"}</div>
          <div className="hint">of {c ? c.games_total.toLocaleString() : "—"} in {c?.seasons ?? "—"} seasons</div>
        </div>
        <div className="card stat-tile">
          <div className="label">Box-score verified</div>
          <div className="value">{verifiedPct !== null ? `${verifiedPct}%` : "—"}</div>
          <div className="hint">
            {v.ok || 0} verified · {v.mismatch || 0} mismatch · {(v.incomplete || 0) + (v.no_boxscore || 0)} incomplete
          </div>
        </div>
        <div className="card stat-tile">
          <div className="label">Players</div>
          <div className="value">{c ? c.players.toLocaleString() : "—"}</div>
          <div className="hint">{c ? c.timeline_points.toLocaleString() : "—"} PIR timeline points</div>
        </div>
        <div className="card stat-tile">
          <div className="label">Live now</div>
          <div className="value">{live.data ? live.data.live.length : "—"}</div>
          <div className="hint">
            <Link href="/live">Open Live Games →</Link>
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <h2>Highest PIR at minute 20 · {current || ""}</h2>
            <Link href="/search" className="subtle">More searches →</Link>
          </div>
          {!top20.data ? <Loading h={200} /> : <TopTable rows={top20.data.results} t={1200} />}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Highest PIR at end of regulation · {current || ""}</h2>
          </div>
          {!topFinal.data ? <Loading h={200} /> : <TopTable rows={topFinal.data.results} t={2400} />}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h2>Latest games</h2><Link href="/games" className="subtle">All games →</Link></div>
          {!live.data ? <Loading h={200} /> : live.data.recent.map((g) => <GameRow key={g.id} g={g} />)}
        </div>
        <div className="card">
          <div className="card-head"><h2>Seasons & data sync</h2></div>
          {!seasons.data ? <Loading h={200} /> : (
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
              <table>
                <thead><tr><th>Season</th><th className="num">Played</th><th className="num">Imported</th></tr></thead>
                <tbody>
                  {seasons.data.map((s) => (
                    <tr key={s.code}>
                      <td><Link href={`/games?season=${s.code}`}>{s.name}</Link></td>
                      <td className="num">{s.games_played}</td>
                      <td className="num">
                        {s.games_imported}
                        {s.games_played > 0 && s.games_imported < s.games_played && <span className="subtle"> ({Math.round((s.games_imported / s.games_played) * 100)}%)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {status.data?.sync && (
            <div className="subtle" style={{ fontSize: 12, marginTop: 10 }}>
              {Object.entries(status.data.sync)
                .filter(([k]) => ["schedule_loop", "live_poller", "backfill"].includes(k))
                .map(([k, s]) => (
                  <div key={k}>{k.replace("_", " ")}: last run {fmtAgo(s.updated_at)}{s.value?.ok === false ? ` — error: ${s.value.error}` : ""}</div>
                ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TopTable({ rows, t }: { rows: AtTimeRow[]; t: number }) {
  if (!rows.length) return <div className="muted-box">No data yet.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Player</th><th>Game</th><th className="num">PIR</th><th className="num">Final</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.game_id + r.player_id}>
              <td><Link href={`/players/${r.player_id}`}>{r.player_display_name}</Link> <span className="subtle">{r.team_code}</span></td>
              <td><Link href={`/games/${r.game_id}?t=${t}&players=${r.player_id}`} className="subtle">vs {r.opponent_code} · {new Date(r.utc_date).toLocaleDateString()}</Link></td>
              <td className="num pir">{r.pir}</td>
              <td className="num subtle">{r.final_pir}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
