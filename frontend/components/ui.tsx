"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, fmtDate, Game } from "@/lib/api";

/** Fetch hook with error state and optional polling. */
export function useApi<T>(
  path: string | null,
  params?: Record<string, string | number | boolean | undefined | null>,
  pollMs?: number,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const key = path ? path + JSON.stringify(params || {}) : null;
  const keyRef = useRef(key);
  keyRef.current = key;

  const load = useCallback(async () => {
    if (!path) return;
    const k = key;
    try {
      const d = await api<T>(path, params);
      if (keyRef.current === k) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (keyRef.current === k) setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      if (keyRef.current === k) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    setLoading(!!path);
    setData(null);
    setError(null);
    load();
  }, [load, path]);

  useEffect(() => {
    if (!pollMs || !path) return;
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs, path]);

  return { data, error, loading, reload: load };
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="alert error" role="alert">⚠ {error}</div>;
}

export function Loading({ h = 120 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} aria-label="Loading" />;
}

export function ValidationBadge({ status }: { status: string | null | undefined }) {
  switch (status) {
    case "ok":
      return <span className="badge good" title="Reconstructed final PIR matches the official box score for every player">✓ Box score verified</span>;
    case "mismatch":
      return <span className="badge bad" title="At least one player's reconstructed PIR differs from the official box score">✗ Mismatch</span>;
    case "incomplete":
      return <span className="badge warn" title="Play-by-play appears incomplete (e.g. no End Game marker)">! Incomplete</span>;
    case "no_boxscore":
      return <span className="badge warn" title="Official box score not available for validation">? No box score</span>;
    case "live":
      return <span className="badge" title="Validated against the box score once the game ends">Live — validated at final</span>;
    default:
      return <span className="badge">{status || "pending"}</span>;
  }
}

export function StatusBadge({ game }: { game: Pick<Game, "status" | "live_stale" | "current_period" | "current_clock"> }) {
  if (game.status === "live") {
    return (
      <span className="row" style={{ gap: 6 }}>
        <span className="badge live"><span className="dot pulse" style={{ background: "#fff" }} /> LIVE</span>
        {game.live_stale && <span className="badge warn" title="No successful update recently">Delayed</span>}
      </span>
    );
  }
  if (game.status === "final") return <span className="badge">Final</span>;
  if (game.status === "postponed") return <span className="badge warn">Postponed</span>;
  if (game.status === "no_data") return <span className="badge warn" title="Feed has no play-by-play for this game">No PBP data</span>;
  return <span className="badge">Scheduled</span>;
}

export function Crest({ src, alt }: { src: string | null | undefined; alt: string }) {
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      className="crest"
      src={src}
      alt={alt}
      loading="lazy"
      onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
    />
  );
}

export function GameRow({ g }: { g: Game }) {
  const showScore = g.home_score !== null && g.status !== "scheduled";
  return (
    <Link href={`/games/${g.id}`} className="list-game">
      <div className="when subtle" style={{ fontSize: 12 }}>
        {fmtDate(g.utc_date)}
        <div>{g.round_name || (g.round ? `Round ${g.round}` : "")}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="team-label" style={{ display: "flex" }}><Crest src={g.home_crest} alt="" /> <span>{g.home_name}</span> {showScore && <b style={{ marginLeft: "auto" }}>{g.home_score}</b>}</div>
        <div className="team-label" style={{ marginTop: 4, display: "flex" }}><Crest src={g.away_crest} alt="" /> <span>{g.away_name}</span> {showScore && <b style={{ marginLeft: "auto" }}>{g.away_score}</b>}</div>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <StatusBadge game={g} />
        {g.pbp_imported_at && g.status !== "live" && <ValidationBadge status={g.validation_status} />}
      </div>
    </Link>
  );
}

export function SeasonSelect({ value, onChange, includeAll = false }: { value: string; onChange: (v: string) => void; includeAll?: boolean }) {
  const { data } = useApi<{ code: string; name: string; games_imported: number }[]>("/seasons");
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Season">
      {includeAll && <option value="">All seasons</option>}
      {(data || []).map((s) => (
        <option key={s.code} value={s.code}>
          {s.name} {s.games_imported ? `(${s.games_imported} games)` : "(not imported)"}
        </option>
      ))}
    </select>
  );
}
