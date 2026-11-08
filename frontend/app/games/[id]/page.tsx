"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import GameExplorer from "@/components/GameExplorer";

function Inner() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const t = sp.get("t");
  const players = sp.get("players");
  return (
    <>
      <div className="page-head">
        <Link href="/games" className="subtle">← Historical games</Link>
      </div>
      <GameExplorer
        key={id}
        gameId={id}
        initialT={t !== null && t !== "" && !Number.isNaN(Number(t)) ? Number(t) : null}
        initialPlayers={players ? players.split(",").filter(Boolean) : undefined}
      />
    </>
  );
}

export default function GamePage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
