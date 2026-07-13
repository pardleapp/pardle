import { Suspense } from "react";
import { BRAND } from "@/lib/brand";
import FeedClient from "./live/FeedClient";
import AddBetTrigger from "./_components/AddBetTrigger";

export const metadata = {
  title: `${BRAND.name} — Live bet tracker + tournament feed`,
  description:
    "Track your golf bets live, see the fair value move with every shot, and watch the tournament alongside other bettors.",
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ replay?: string; tournament?: string }>;
}

export default async function HomeLive({ searchParams }: PageProps) {
  const params = await searchParams;
  // ?replay=R2026541 or ?tournament=R2026541 — render the feed
  // from that tournament's cached events instead of the active one.
  // Used pre-tournament to iterate on the feed shape against real
  // historical data (Scottish Open R4 sitting in Redis right now
  // is a perfect stress-test dataset).
  const replayId = params.replay || params.tournament || undefined;
  return (
    <main className="container container-wide v4-theme pv-theme">
      {replayId && (
        <div
          style={{
            padding: "8px 14px",
            background: "oklch(0.92 0.05 60)",
            color: "oklch(0.30 0.06 60)",
            fontSize: 12,
            fontWeight: 700,
            textAlign: "center",
            letterSpacing: 0.4,
          }}
        >
          REPLAY MODE · {replayId} · not live
        </div>
      )}
      <FeedClient forcedTournamentId={replayId} />
      <Suspense fallback={null}>
        <AddBetTrigger />
      </Suspense>
    </main>
  );
}
