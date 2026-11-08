// Typed client for the FastAPI backend (proxied at /api by next.config.mjs).

export type GameStatus = "scheduled" | "live" | "final" | "postponed" | "no_data";

export interface Game {
  id: string;
  season_code: string;
  game_code: number;
  round: number | null;
  round_name: string | null;
  phase: string | null;
  utc_date: string | null;
  home_code: string;
  home_name: string;
  home_crest: string | null;
  away_code: string;
  away_name: string;
  away_crest: string | null;
  home_score: number | null;
  away_score: number | null;
  status: GameStatus;
  current_period: number | null;
  current_clock: string | null;
  max_period: number | null;
  num_events: number;
  pbp_imported_at: string | null;
  last_live_update: string | null;
  last_error: string | null;
  validation_status: string;
  live_stale: boolean | null;
  validation?: {
    status: string;
    checked: number;
    mismatches: { player_id: string; player: string; reconstructed: number; official: number; diff: number }[];
    points_issues?: string[];
  };
  warnings?: string[];
}

export interface GamePlayer {
  player_id: string;
  name: string;
  display_name: string;
  team_code: string;
  opponent_code: string | null;
  dorsal: string | null;
  is_starter: boolean;
  minutes: string | null;
  played: boolean;
  official_pir: number | null;
  final_pir: number;
  max_pir: number;
  max_pir_elapsed: number;
  min_pir: number;
  min_pir_elapsed: number;
  max_drop: number;
  validated: boolean | null;
}

export interface Period {
  period: number;
  start: number;
  end: number;
  label: string;
}

export interface GameDetail extends Game {
  players: GamePlayer[];
  game_end_seconds: number;
  last_event_elapsed: number | null;
  periods: Period[];
}

export interface TimelinePoint {
  seq: number;
  elapsed_seconds: number;
  period: number;
  marker_time: string;
  play_type: string;
  play_info: string;
  delta: number;
  pir: number;
}

export interface Season {
  code: string;
  name: string;
  alias: string;
  year: number;
  games_total: number;
  games_imported: number;
  games_played: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, params?: Record<string, string | number | boolean | undefined | null>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const url = `/api${path}${qs.toString() ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (e) {
    throw new ApiError(0, "Cannot reach the PIR backend. Is the API server running?");
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    if (res.status >= 500 && res.status < 600 && msg.startsWith("50")) msg = "Backend unavailable (" + msg + ")";
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

// ------------------------------------------------------------------ time helpers

export const REG_PERIOD = 600;
export const OT_PERIOD = 300;

export function periodStart(p: number): number {
  return p <= 4 ? (p - 1) * REG_PERIOD : 4 * REG_PERIOD + (p - 5) * OT_PERIOD;
}
export function periodEnd(p: number): number {
  return periodStart(p) + (p <= 4 ? REG_PERIOD : OT_PERIOD);
}
export function periodLabel(p: number): string {
  return p <= 4 ? `Q${p}` : `OT${p - 4}`;
}

/** 725 -> "12:05" (elapsed game time) */
export function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** elapsed seconds -> { period, clock } where clock is the remaining time on the game clock */
export function gameClock(elapsed: number): { period: number; clock: string } {
  let p = 1;
  while (elapsed > periodEnd(p) && p < 20) p++;
  const rem = Math.max(0, Math.round(periodEnd(p) - elapsed));
  return { period: p, clock: `${String(Math.floor(rem / 60)).padStart(2, "0")}:${String(rem % 60).padStart(2, "0")}` };
}

export function fmtGameClock(elapsed: number): string {
  const { period, clock } = gameClock(elapsed);
  return `${periodLabel(period)} ${clock}`;
}

/** "12:05" or "12" or "12.5" -> seconds; null if invalid */
export function parseElapsed(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  if (s.includes(":")) {
    const [m, sec] = s.split(":");
    const mm = Number(m), ss = Number(sec);
    if (!Number.isFinite(mm) || !Number.isFinite(ss) || ss >= 60 || ss < 0 || mm < 0) return null;
    return Math.round(mm * 60 + ss);
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null;
}

/** Cumulative PIR after all events at or before `t` (timeline sorted by seq). */
export function pirAt(timeline: TimelinePoint[] | undefined, t: number): number {
  if (!timeline) return 0;
  let pir = 0;
  for (const p of timeline) {
    if (p.elapsed_seconds > t) break;
    pir = p.pir;
  }
  return pir;
}

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

// Categorical series palette (dark-surface steps of a CVD-validated order).
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767", "#7fb2f0"];
