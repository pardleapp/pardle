/**
 * /players/[id] — per-player drill-down using the season-rounds.json
 * dataset. Works regardless of whether a tournament is currently
 * live (off-week click-through from /players).
 *
 * `id` is the normalised-name key used by season-rounds.json (e.g.
 * "wyndhamclark") — human-readable, decoupled from in-tournament
 * state.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND } from "@/lib/brand";
import seasonRoundsRaw from "@/lib/data/season-rounds.json";
import { getRecentFormByName } from "@/lib/feed/recent-form";
import type { SeasonRoundsEntry } from "@/lib/feed/season-rounds";
import AuthChip from "../../live/auth/AuthChip";
import MainNav from "../../MainNav";
import PlayerSeasonView from "../../live/PlayerSeasonView";

const DATA = seasonRoundsRaw as Record<string, SeasonRoundsEntry>;

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const entry = DATA[id];
  if (!entry) return { title: `Player — ${BRAND.name}` };
  return {
    title: `${entry.name} — ${BRAND.name}`,
    description: `${entry.name} 2026 season stats: ${entry.rounds.length} rounds, recent form, eagle + sub-67 counts.`,
  };
}

export default async function PlayerSeasonPage({ params }: PageProps) {
  const { id } = await params;
  const entry = DATA[id];
  if (!entry) notFound();

  const recentForm = getRecentFormByName(entry.name);

  return (
    <main className="container container-wide v4-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="none" />
          <AuthChip />
        </div>
      </header>

      <Link href="/players" className="player-season-back">
        ← All players
      </Link>
      <h2 className="player-season-name">{entry.name}</h2>
      <PlayerSeasonView entry={entry} recentForm={recentForm} />
    </main>
  );
}
