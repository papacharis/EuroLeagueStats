"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PirChart, { Series } from "@/components/PirChart";
import { ErrorBox, Loading, useApi, ValidationBadge } from "@/components/ui";
import { api, fmtDate, fmtElapsed, parseElapsed, periodEnd, periodStart, SERIES_COLORS, TimelinePoint } from "@/lib/api";

const CPS = ["5", "10", "15", "20", "25", "30", "35", "40"];

interface ProfileGame {
  game_id: string;
  season_code: string;
  utc_date: string;
  round: number;
  team_code: string;
  opponent_code: string;
  home_code: string;
  away_code: string;
  home_score: number | null;
  away_score: number | null;
  final_pir: number;
  official_pir: number | null;
  max_pir: number;
  max_pir_elapsed: number;
  min_pir: number;
  min_pir_elapsed: number;
  max_drop: number;
  minutes: string | null;
  validation_status: string;
  max_period: number | null;
  checkpoints: Record<string, number | null>;
}

interface Profile {
  player: { id: string; display_name: string; last_team_name: string | null; last_team_code: string | null };
  seasons: string[];
  summary: {
    games: number;
    avg_final_pir: number | null;
    best_final_pir: number | null;
    worst_final_pir: number | null;
    avg_max_pir: number | null;
    avg_min_pir: number | null;
    avg_at_minute: Record<string, number | null>;
  };
  games: ProfileGame[];
}

function Inner() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const [season, setSeason] = useState(sp.get("season") || "");
  const prof = useApi<Profile>(`/players/${id}`, { season });
  const [compare, setCompare] = useState<string[]>([]);
  const [tls, setTls] = useState<Record<string, TimelinePoint[]>>({});
  const [minuteInput, setMinuteInput] = useState("10:00");
  const [lastN, setLastN] = useState(20);
  const [atT, setAtT] = useState(600);
  const atTime = useApi<{ games: { game_id: string; pir: number; utc_date: string; opponent_code: string; final_pir: number }[]; average: number | null }>(
    `/players/${id}/at-time`, { t: atT, last: lastN, season },
  );

  const data = prof.data;

  useEffect(() => {
    if (data && compare.length === 0 && data.games.length) setCompare(data.games.slice(0, 3).map((g) => g.game_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    const missing = compare.filter((g) => !tls[g]);
    if (!missing.length) return;
    Promise.all(
      missing.map((gid) =>
        api<{ timelines: Record<string, TimelinePoint[]> }>(`/games/${gid}/timeline`, { players: id }).then((r) => [gid, r.timelines[id] || []] as const),
      ),
    ).then((pairs) => setTls((prev) => ({ ...prev, ...Object.fromEntries(pairs) })));
  }, [compare, id, tls]);

  const gamesById = useMemo(() => Object.fromEntries((data?.games || []).map((g) => [g.game_id, g])), [data]);
  const colorFor = useMemo(() => Object.fromEntries(compare.map((g, i) => [g, SERIES_COLORS[i % SERIES_COLORS.length]])), [compare]);

  if (prof.error) return <ErrorBox error={prof.error} />;
  if (!data) return <Loading h={400} />;

  const series: Series[] = compare
    .filter((g) => gamesById[g])
    .map((g) => ({
      id: g,
      name: `vs ${gamesById[g].opponent_code} ${fmtDate(gamesById[g].utc_date)}`,
      color: colorFor[g],
      timeline: tls[g] || [],
    }));
  const maxPeriod = Math.max(4, ...compare.map((g) => gamesById[g]?.max_period || 4));
  const periods = Array.from({ length: maxPeriod }, (_, i) => ({
    period: i + 1, start: periodStart(i + 1), end: periodEnd(i + 1), label: i < 4 ? `Q${i + 1}` : `OT${i - 3}`,
  }));

  const trajectory = CPS.map((m) => ({ minute: Number(m), avg: data.summary.avg_at_minute[m] }));
  const atRows = [...(atTime.data?.games || [])].reverse();

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/players" className="subtle">← Players</Link>
          <h1 style={{ marginTop: 6 }}>{data.player.display_name}</h1>
          <div className="secondary">{data.player.last_team_name || data.player.last_team_code} · {data.player.id}</div>
        </div>
        <div className="field">
          <label>Season</label>
          <select value={season} onChange={(e) => { setSeason(e.target.value); setCompare([]); }}>
            <option value="">All seasons</option>
            {data.seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat-tile"><div className="label">Games</div><div className="value">{data.summary.games}</div></div>
        <div className="card stat-tile"><div className="label">Avg final PIR</div><div className="value">{data.summary.avg_final_pir ?? "—"}</div><div className="hint">best {data.summary.best_final_pir ?? "—"} · worst {data.summary.worst_final_pir ?? "—"}</div></div>
        <div className="card stat-tile"><div className="label">Avg in-game peak</div><div className="value">{data.summary.avg_max_pir ?? "—"}</div><div className="hint">highest PIR reached during games</div></div>
        <div className="card stat-tile"><div className="label">Avg in-game low</div><div className="value">{data.summary.avg_min_pir ?? "—"}</div><div className="hint">lowest PIR reached during games</div></div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h2>Average PIR by game minute</h2></div>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={trajectory} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="minute" tickFormatter={(m) => `${m}'`} tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false} axisLine={{ stroke: "var(--border-strong)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Tooltip contentStyle={{ background: "var(--surface-3)", border: "1px solid var(--border-strong)", borderRadius: 8 }} labelFormatter={(m) => `Minute ${m}`} formatter={(v) => [v as number, "Avg PIR"]} />
                <Line dataKey="avg" stroke={SERIES_COLORS[0]} strokeWidth={2} dot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>PIR at {fmtElapsed(atT)} — last {lastN} games</h2>
            <form className="row" onSubmit={(e) => { e.preventDefault(); const v = parseElapsed(minuteInput); if (v !== null) setAtT(v); }}>
              <input type="text" value={minuteInput} onChange={(e) => setMinuteInput(e.target.value)} style={{ width: 70 }} aria-label="Elapsed time" />
              <select value={lastN} onChange={(e) => setLastN(Number(e.target.value))} aria-label="Number of games">
                {[5, 10, 20, 40, 82].map((n) => <option key={n} value={n}>last {n}</option>)}
              </select>
              <button className="btn small primary">Apply</button>
            </form>
          </div>
          <div className="subtle" style={{ fontSize: 12, marginBottom: 6 }}>Average: <b className="pir" style={{ color: "var(--text-primary)" }}>{atTime.data?.average ?? "—"}</b></div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={atRows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="opponent_code" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickLine={false} axisLine={{ stroke: "var(--border-strong)" }} interval={0} angle={-45} textAnchor="end" height={40} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  contentStyle={{ background: "var(--surface-3)", border: "1px solid var(--border-strong)", borderRadius: 8 }}
                  labelFormatter={(_, p) => (p?.[0] ? `vs ${p[0].payload.opponent_code} · ${fmtDate(p[0].payload.utc_date)}` : "")}
                  formatter={(v, _n, p) => [`${v} (final ${(p as any).payload.final_pir})`, `PIR at ${fmtElapsed(atT)}`]}
                />
                <Bar dataKey="pir" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {atRows.map((r) => <Cell key={r.game_id} fill={r.pir >= 0 ? SERIES_COLORS[0] : SERIES_COLORS[1]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>Match-by-match comparison</h2>
          <span className="subtle" style={{ fontSize: 12 }}>Tick games in the table below (up to 8)</span>
        </div>
        {series.length ? <PirChart series={series} range={[0, periodEnd(maxPeriod)]} periods={periods} /> : <div className="muted-box">Select games below to overlay their PIR timelines.</div>}
        <div className="legend" style={{ marginTop: 8 }}>
          {series.map((s) => <span key={s.id}><span className="dot" style={{ background: s.color }} />{s.name}</span>)}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>All matches</h2><span className="subtle" style={{ fontSize: 12 }}>PIR at minute 5 … 40, final, in-game high/low</span></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th><th>Date</th><th>Game</th>
                {CPS.map((m) => <th key={m} className="num">{m}&apos;</th>)}
                <th className="num">Final</th><th className="num">High</th><th className="num">Low</th><th className="num">Drop</th><th>Check</th>
              </tr>
            </thead>
            <tbody>
              {data.games.map((g) => (
                <tr key={g.game_id} className={compare.includes(g.game_id) ? "selected" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={compare.includes(g.game_id)}
                      onChange={() => setCompare((c) => (c.includes(g.game_id) ? c.filter((x) => x !== g.game_id) : c.length >= 8 ? c : [...c, g.game_id]))}
                      aria-label="Compare"
                    />
                    {compare.includes(g.game_id) && <span className="dot" style={{ background: colorFor[g.game_id], marginLeft: 6 }} />}
                  </td>
                  <td className="subtle">{fmtDate(g.utc_date)}</td>
                  <td>
                    <Link href={`/games/${g.game_id}?players=${id}`}>
                      {g.team_code === g.home_code ? "vs" : "@"} {g.opponent_code}
                    </Link>{" "}
                    <span className="subtle">{g.home_score}-{g.away_score}</span>
                  </td>
                  {CPS.map((m) => <td key={m} className="num">{g.checkpoints[m] ?? "—"}</td>)}
                  <td className="num pir">{g.final_pir}</td>
                  <td className="num" title={`at ${fmtElapsed(g.max_pir_elapsed)}`}>{g.max_pir}</td>
                  <td className="num" title={`at ${fmtElapsed(g.min_pir_elapsed)}`}>{g.min_pir}</td>
                  <td className="num">{g.max_drop}</td>
                  <td>{g.official_pir === null ? <ValidationBadge status={g.validation_status} /> : g.official_pir === g.final_pir ? <span className="badge good">✓ {g.official_pir}</span> : <span className="badge bad">≠ {g.official_pir}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function PlayerPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
