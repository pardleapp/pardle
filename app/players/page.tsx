/**
 * /players — index of every PGA Tour player we have data on, with
 * search. Sits alongside Feed / Bets / Leaderboard / Course as a
 * surface that's useful regardless of whether a tournament's live.
 *
 * Sources season-rounds.json (the per-round dataset we maintain via
 * the weekly GitHub Action) — so every player listed has at least
 * one PGA Tour start this season. Clicking a row → /players/[key]
 * for the player drill-down with their season stats.
 *
 * Server component for the data + metadata; the searchable list is
 * client-side so typing filters without a round-trip.
 */

import { BRAND } from "@/lib/brand";
import seasonRoundsRaw from "@/lib/data/season-rounds.json";
import type { SeasonRoundsEntry } from "@/lib/feed/season-rounds";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";
import PlayersListClient, { type PlayerSummary } from "./PlayersListClient";

const DATA = seasonRoundsRaw as Record<string, SeasonRoundsEntry>;

export const metadata = {
  title: `Players — ${BRAND.name}`,
  description:
    "Browse every PGA Tour player by season stats, recent form, and round-level detail.",
};

function summariseForList(
  key: string,
  entry: SeasonRoundsEntry,
): PlayerSummary {
  const rounds = entry.rounds;
  const events = new Set(rounds.map((r) => r.eventId));
  const eagles = rounds.reduce((s, r) => s + r.eagles, 0);
  const sub67 = rounds.filter((r) => r.score > 0 && r.score < 67).length;
  const red = rounds.filter((r) => r.vsPar < 0).length;
  const avgSg =
    rounds.length > 0
      ? rounds.reduce((s, r) => s + (r.sgTotal ?? 0), 0) / rounds.length
      : 0;
  const lastRound = rounds[0] ?? null;
  return {
    key,
    name: entry.name,
    starts: events.size,
    rounds: rounds.length,
    eagles,
    sub67,
    red,
    avgSg,
    lastEvent: lastRound?.tournament ?? null,
    lastDate: lastRound?.date ?? null,
  };
}

export default function PlayersIndexPage() {
  const players: PlayerSummary[] = Object.entries(DATA)
    .map(([key, entry]) => summariseForList(key, entry))
    .filter((p) => p.rounds > 0)
    // Default sort: most rounds played this season (proxy for "most
    // active / most relevant"). Client toggles to alphabetical too.
    .sort((a, b) => b.rounds - a.rounds);

  return (
    <main className="container container-wide v4-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="none" />
          <AuthChip />
        </div>
      </header>
      <PlayersListClient players={players} />
    </main>
  );
}
