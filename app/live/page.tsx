import { Suspense } from "react";
import { BRAND } from "@/lib/brand";
import FeedClient from "./FeedClient";
import LeaderboardFeed from "./v4/LeaderboardFeed";
import AddBetTrigger from "../_components/AddBetTrigger";

export const metadata = {
  title: `${BRAND.name} — Live bet tracker + tournament feed`,
  description:
    "Track your golf bets live, see the fair value move with every shot, and watch the tournament alongside other bettors.",
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
     *  event in the buffer. */
    back?: string;
    /** Feed visual variant. Default is v4 — the live-leaderboard
     *  view with per-shot reactions, comments and SG breakdown.
     *  `v=1` falls back to the classic sweat feed; `v=3` opts into
     *  the interim priority-weighted preview. */
    v?: string;
  }>;
}

export default async function LiveFeed({ searchParams }: PageProps) {
  const params = await searchParams;
  const replayId = params.replay || params.tournament || undefined;
  const backHours =
    params.back != null && Number.isFinite(Number(params.back))
      ? Number(params.back)
      : undefined;
  const requested: "v1" | "v3" | "v4" =
    params.v === "1"
      ? "v1"
      : params.v === "3"
        ? "v3"
        : params.v === "4"
          ? "v4"
          : "v4";
  const variant = replayId ? "v1" : requested;
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
      {variant === "v4" ? (
        <LeaderboardFeed />
      ) : (
        <FeedClient
          forcedTournamentId={replayId}
          replayBackHours={backHours}
          variant={variant === "v3" ? "v3" : "v1"}
        />
      )}
      <Suspense fallback={null}>
        <AddBetTrigger />
      </Suspense>
    </main>
  );
}
