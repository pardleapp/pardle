import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `${BRAND.name} Fantasy — daily fantasy golf with friends`,
  description:
    "Create a private fantasy golf league with up to 10 friends, pick 6 pros, and live-score every birdie, eagle and bogey through the tournament.",
};

export default function FantasyHubPage() {
  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Fantasy · friends-only golf pool</p>
      </header>

      <section className="fantasy-hero">
        <h2 className="fantasy-hero-title">Fantasy golf with your friends</h2>
        <p className="fantasy-hero-sub">
          Pick 6 pros before the tournament. Score points every round for
          birdies, eagles and bogeys. Top of the leaderboard wins bragging
          rights for the week.
        </p>

        <div className="fantasy-cta-row">
          <Link href="/fantasy/create" className="fantasy-cta-primary">
            Create a league
          </Link>
          <Link href="/fantasy/join" className="fantasy-cta-secondary">
            Join with code
          </Link>
        </div>
      </section>

      <section className="fantasy-explain">
        <h3 className="fantasy-section-title">How it works</h3>
        <ol className="fantasy-steps">
          <li>
            <strong>Create a league</strong> for the upcoming tournament and
            invite up to 10 friends with a shareable link.
          </li>
          <li>
            <strong>Pick 6 pros across 4 tiers</strong> — 1 favourite (top 10),
            2 contenders (11–30), 2 outsiders (31–60), 1 dark horse (61+).
            Everyone picks before R1 tees off.
          </li>
          <li>
            <strong>Name a captain &amp; vice-captain.</strong> Your captain&apos;s
            points are doubled. If they miss the cut, your vice steps in.
          </li>
          <li>
            <strong>Nominate your double-round.</strong> Save R4 for a Sunday
            hero swing, or play it safe with R1. That round&apos;s birdies,
            eagles and bogeys count 2x — stacks with captain.
          </li>
          <li>
            <strong>Score updates round-by-round.</strong> Birdies +3,
            eagles +8, bogeys −1, doubles −3, plus finish-position bonuses
            on Sunday. Sweat the leaderboard and trash-talk in the league
            chat.
          </li>
        </ol>
      </section>

      <section className="fantasy-status">
        <p className="fantasy-status-note">
          🏗️ Fantasy is in beta and will launch in time for the{" "}
          <strong>US Open</strong> (June 11–14). Create a league now and
          we&apos;ll let you know the moment picks open.
        </p>
      </section>
    </main>
  );
}
