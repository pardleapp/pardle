import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import FeedClient from "@/app/live/FeedClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata(_: PageProps): Promise<Metadata> {
  return {
    title: `Replay — ${BRAND.name}`,
    description:
      "Frozen view of a past tournament — live feed, leaderboard, bet tracker as they appeared.",
  };
}

export const dynamic = "force-dynamic";

/**
 * /replay/[id] — renders the full live-feed UI for a specific past
 * tournament, sourced from the archived Redis buffers via the
 * /api/feed?tournamentId=X override. Used for demos, screenshots,
 * and any "show people what it looked like during X" use case.
 *
 * Visual is identical to the home page during a live event — same
 * leaderboard, same reels, same bet tracker, same feed rows. The
 * data is frozen at whatever state the archived buffers contain.
 */
export default async function ReplayPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="container container-wide">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <span className="replay-badge">REPLAY · {id}</span>
          <Link href="/" className="hub-nav-tab">
            ← Live feed
          </Link>
        </div>
      </header>
      <FeedClient forcedTournamentId={id} />
    </main>
  );
}
