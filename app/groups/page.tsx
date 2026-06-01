/**
 * /groups — coming-soon placeholder for the private-groups surface
 * (P&L race, group members, shared invite links, member profiles).
 * Per the design-handoff build order, Groups is step 4 of the
 * Sweat-Feed redesign and depends on a new Supabase tables layer
 * we haven't built yet. The mobile BottomNav already links here, so
 * the page exists to keep the nav promise — clear copy on what's
 * coming + a CTA back to the live feed.
 */

import Link from "next/link";
import { BRAND } from "@/lib/brand";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";

export const metadata = {
  title: `Groups — ${BRAND.name}`,
  description:
    "Private bet-tracking groups with a shared P&L race — coming soon.",
};

export default function GroupsPage() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="none" />
          <AuthChip />
        </div>
      </header>
      <section className="groups-soon">
        <p className="groups-soon-eyebrow">Coming soon</p>
        <h2 className="groups-soon-title">Sweat with your crew</h2>
        <p className="groups-soon-blurb">
          Private bet-tracking groups — track a shared P&amp;L race
          with your mates, see who&apos;s on what, and react to each
          other&apos;s wins and losses in real time. Launching with
          the next major release.
        </p>
        <div className="groups-soon-cta-row">
          <Link href="/" className="groups-soon-cta">
            Back to the live feed
          </Link>
          <Link href="/bets" className="groups-soon-cta-quiet">
            Track a bet
          </Link>
        </div>
      </section>
    </main>
  );
}
