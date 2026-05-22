/**
 * /leaderboard — dedicated leaderboard tab. Sits alongside Live feed,
 * Bets, and Games at the top of the nav. Replaces the in-page view
 * toggle that used to live inside FeedClient.
 */

import { BRAND } from "@/lib/brand";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";
import LeaderboardClient from "./LeaderboardClient";

export const metadata = {
  title: `Leaderboard — ${BRAND.name}`,
  description: "Live tournament leaderboard with form, hot/cold momentum, and SG breakdowns.",
};

export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  return (
    <main className="container container-wide v4-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="leaderboard" />
          <AuthChip />
        </div>
      </header>
      <LeaderboardClient />
    </main>
  );
}
