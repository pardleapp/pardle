/**
 * /live/player/[id] — redesigned player surface (pass 8).
 *
 * Replaces the older PlayerHighlights / PlayerStats / PlayerSeasonView /
 * RecentHoles stack with the design-handoff prototype's PlayerPage +
 * EventDetail + Scorecard. Mock data drives the first cut so the
 * layout is exact end-to-end before we wire orchestrator scorecards
 * + DataGolf SG.
 *
 * Best-effort name resolution from the live leaderboard so OG/Twitter
 * cards still carry the player name; falls back to the mock key for
 * unknown ids.
 */

import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import {
  getActiveTournament,
  getLeaderboard,
} from "@/lib/golf-api/pgatour";
import PlayerPageClient from "./PlayerPageClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function resolveName(id: string): Promise<string | null> {
  try {
    const active = await getActiveTournament();
    if (!active) return null;
    const lb = await getLeaderboard(active.tournament.id);
    return lb.find((r) => r.playerId === id)?.displayName ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const playerName = await resolveName(id);
  if (!playerName) {
    return {
      title: `Player — ${BRAND.name}`,
      description: "Tournament scorecard, season form, recent shots.",
    };
  }
  const title = `${playerName} — ${BRAND.name}`;
  const description = `Tournament scorecard, season form and recent shots for ${playerName}.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "profile" },
    twitter: { card: "summary", title, description },
  };
}

export default async function PlayerPage({ params }: PageProps) {
  const { id } = await params;
  const playerName = await resolveName(id);
  return (
    <main className="container container-wide v4-theme pv-theme">
      <PlayerPageClient playerId={id} initialName={playerName} />
    </main>
  );
}
