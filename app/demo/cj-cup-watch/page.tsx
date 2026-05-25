/**
 * /demo/cj-cup-watch — auto-playing animated replay of Sunday's CJ
 * Cup Byron Nelson finish for a £100 outright on Wyndham Clark at
 * +4900. Designed to be the most shareable URL Pardle has:
 *
 *   - The page autoplays on load (13s sequence) — anyone who clicks
 *     watches Clark's back 9 build up and the running total tick to
 *     £5,000 with the eagle + 44-foot putt as the visual climaxes.
 *   - Loops, so screenshots / screen recordings always show motion.
 *   - Mobile-first layout — fills a phone screen with no scroll.
 *   - The OG share card pre-renders the +£5,000 number so any link
 *     paste into WhatsApp / Twitter / Discord lands as a scroll-
 *     stopper before the user even taps through.
 *
 * Pure client component — no API calls, no data fetching. Real shot
 * data is hardcoded from the orchestrator R4 scorecard (eagle on
 * 12, 44 ft 8 in. putt on 15, etc.) so the page is dead-cheap to
 * serve and can be linked anywhere without backend load.
 */

import type { Metadata } from "next";
import CjCupWatchClient from "./CjCupWatchClient";

export const metadata: Metadata = {
  title: "£100 → £5,000 · Watch Clark's CJ Cup win on Pardle",
  description:
    "Hole by hole on Sunday at the CJ Cup Byron Nelson: eagle on 12, 44-foot birdie on 15, the £ on a £100 outright bet ticking from £1,250 to £5,000 in real time.",
};

export default function CjCupWatchPage() {
  return <CjCupWatchClient />;
}
