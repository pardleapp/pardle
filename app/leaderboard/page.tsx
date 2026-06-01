/**
 * /leaderboard — redesigned to match the design-handoff prototype's
 * Leaderboard component. Mock-data driven for the first cut; real
 * orchestrator wiring lands in a follow-up.
 */

import { BRAND } from "@/lib/brand";
import SweatHeader from "../live/SweatHeader";
import LeaderboardClientV2 from "./LeaderboardClientV2";

export const metadata = {
  title: `Leaderboard — ${BRAND.name}`,
  description: "Live tournament leaderboard.",
};

export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <SweatHeader />
      <LeaderboardClientV2 />
    </main>
  );
}
