/**
 * /sharp — Sharp Score surface. Rebuilt to match the design-handoff
 * prototype's <Sharp>: hero gauge + active Putt-IQ poll + open /
 * settled calls list. Mock-data driven for the first cut; real
 * wiring (sharp-score module + putt-iq leaderboard) lands in a
 * follow-up.
 */

import { BRAND } from "@/lib/brand";
import SweatHeader from "../live/SweatHeader";
import SharpClient from "./SharpClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Sharp Score — ${BRAND.name}`,
  description:
    "Your accuracy across every prediction on Pardle — putt-polls, hold-the-lead calls, bet outcomes.",
};

export default function SharpPage() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <SweatHeader />
      <SharpClient />
    </main>
  );
}
