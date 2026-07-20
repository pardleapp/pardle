import { Suspense } from "react";
import { BRAND } from "@/lib/brand";
import FeedClient from "./live/FeedClient";
import AddBetTrigger from "./_components/AddBetTrigger";

export const metadata = {
  title: `${BRAND.name} — Live bet tracker + tournament feed`,
  description:
    "Track your golf bets live, see the fair value move with every shot, and watch the tournament alongside other bettors.",
  // Explicitly clear the openGraph/twitter blocks that layout.tsx sets
  // globally, so pardle.app unfurls as a plain link (no rich card).
  // Lets Tom drop his own screenshots into posts without competing
  // against an auto-generated card. To restore: delete these two
  // nulls and un-disable app/opengraph-image.disabled.tsx.
  openGraph: null,
  twitter: null,
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    replay?: string;
    tournament?: string;
    /** Rewind cutoff — hours to subtract from "now" when filtering
     *  events. e.g. `back=6` shows events ≤ 6 h before the latest
     *  event in the buffer. Lets us test mid-round density instead
     *  of being stuck at end-of-R4 where the field is compressed. */
    back?: string;
    /** Feed visual variant. `v=3` opts into the priority-weighted
     *  trading-terminal layout preview. Data pipeline is identical
     *  — v3 is a pure render swap. Undocumented; internal preview
     *  flag until we're ready to flip the default. */
    v?: string;
  }>;
}

export default async function HomeLive({ searchParams }: PageProps) {
  const params = await searchParams;
  // ?replay=R2026541 or ?tournament=R2026541 — render the feed
  // from that tournament's cached events instead of the active one.
  // Used pre-tournament to iterate on the feed shape against real
  // historical data.
  const replayId = params.replay || params.tournament || undefined;
  const backHours =
    params.back != null && Number.isFinite(Number(params.back))
      ? Number(params.back)
      : undefined;
  const variant = params.v === "3" ? "v3" : "v1";
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
          REPLAY MODE · {replayId}
          {backHours != null ? ` · rewound ${backHours}h` : ""} · not live
        </div>
      )}
      <FeedClient
        forcedTournamentId={replayId}
        replayBackHours={backHours}
        variant={variant}
      />
      <Suspense fallback={null}>
        <AddBetTrigger />
      </Suspense>
    </main>
  );
}
