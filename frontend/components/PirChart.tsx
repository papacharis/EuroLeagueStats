"use client";
import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtElapsed, fmtGameClock, Period, pirAt, signed, TimelinePoint } from "@/lib/api";

export interface Series {
  id: string;
  name: string;
  color: string;
  timeline: TimelinePoint[];
  dashed?: boolean;
}

interface Props {
  series: Series[];
  range: [number, number];
  periods: Period[];
  cursor?: number | null;
  onSelectTime?: (t: number) => void;
  height?: number;
  xMode?: "elapsed" | "clock";
}

type Row = { t: number } & Record<string, number>;

export default function PirChart({ series, range, periods, cursor, onSelectTime, height = 360, xMode = "elapsed" }: Props) {
  const [r0, r1] = range;

  const data: Row[] = useMemo(() => {
    const times = new Set<number>([r0, r1]);
    for (const s of series) for (const p of s.timeline) if (p.elapsed_seconds > r0 && p.elapsed_seconds <= r1) times.add(p.elapsed_seconds);
    return Array.from(times)
      .sort((a, b) => a - b)
      .map((t) => {
        const row: Row = { t } as Row;
        for (const s of series) row[s.id] = pirAt(s.timeline, t);
        return row;
      });
  }, [series, r0, r1]);

  const [yMin, yMax] = useMemo(() => {
    let lo = 0, hi = 5;
    for (const r of data) for (const s of series) { lo = Math.min(lo, r[s.id]); hi = Math.max(hi, r[s.id]); }
    return [Math.floor(lo / 5) * 5, Math.ceil((hi + 1) / 5) * 5];
  }, [data, series]);

  const span = r1 - r0;
  const step = span <= 300 ? 30 : span <= 600 ? 60 : span <= 1500 ? 120 : 300;
  const ticks: number[] = [];
  for (let x = Math.ceil(r0 / step) * step; x <= r1; x += step) ticks.push(x);

  const fmtTick = (v: number) => (xMode === "clock" ? fmtGameClock(v) : fmtElapsed(v).replace(/:00$/, "'"));

  const TooltipContent = ({ active, label }: { active?: boolean; label?: number | string }) => {
    if (!active || label === undefined) return null;
    const t = Number(label);
    return (
      <div className="chart-tooltip">
        <div className="t">
          <b style={{ color: "var(--text-primary)" }}>{fmtElapsed(t)}</b> elapsed · {fmtGameClock(t)}
        </div>
        {series.map((s) => {
          const evs = s.timeline.filter((p) => p.elapsed_seconds === t);
          return (
            <div key={s.id} style={{ marginTop: 4 }}>
              <div className="row" style={{ gap: 6, justifyContent: "space-between", flexWrap: "nowrap" }}>
                <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                  <span className="dot" style={{ background: s.color }} />
                  <span>{s.name}</span>
                </span>
                <b className="pir">{pirAt(s.timeline, t)}</b>
              </div>
              {evs.map((e) => (
                <div key={e.seq} className="subtle" style={{ paddingLeft: 14 }}>
                  <span className={e.delta > 0 ? "delta-pos" : "delta-neg"}>{signed(e.delta)}</span> {e.play_info || e.play_type}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 18, right: 16, bottom: 4, left: -12 }}
          onClick={(state: any) => {
            const lbl = state?.activeLabel;
            if (lbl !== undefined && lbl !== null && onSelectTime) onSelectTime(Number(lbl));
          }}
          style={{ cursor: onSelectTime ? "crosshair" : undefined }}
        >
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          {periods
            .filter((p) => p.period % 2 === 0 && p.end > r0 && p.start < r1)
            .map((p) => (
              <ReferenceArea key={`a${p.period}`} x1={Math.max(p.start, r0)} x2={Math.min(p.end, r1)} fill="#ffffff" fillOpacity={0.025} ifOverflow="hidden" />
            ))}
          <XAxis
            dataKey="t"
            type="number"
            domain={[r0, r1]}
            ticks={ticks}
            tickFormatter={fmtTick}
            stroke="var(--text-muted)"
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border-strong)" }}
            allowDataOverflow
          />
          <YAxis
            domain={[yMin, yMax]}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          {periods
            .filter((p) => p.start > r0 && p.start < r1)
            .map((p) => (
              <ReferenceLine
                key={`p${p.period}`}
                x={p.start}
                stroke="var(--text-muted)"
                strokeDasharray="3 4"
                label={{ value: p.label, position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 11 }}
              />
            ))}
          {r0 === 0 && (
            <ReferenceLine x={0} stroke="transparent" label={{ value: periods[0]?.label || "Q1", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 11 }} />
          )}
          {cursor !== null && cursor !== undefined && cursor >= r0 && cursor <= r1 && (
            <ReferenceLine x={cursor} stroke="var(--accent)" strokeWidth={2} ifOverflow="hidden" />
          )}
          <Tooltip content={<TooltipContent />} cursor={{ stroke: "var(--text-secondary)", strokeDasharray: "2 3" }} isAnimationActive={false} />
          {series.map((s) => (
            <Line
              key={s.id}
              dataKey={s.id}
              name={s.name}
              type="stepAfter"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "6 4" : undefined}
              dot={false}
              activeDot={{ r: 5, stroke: "var(--surface-1)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
