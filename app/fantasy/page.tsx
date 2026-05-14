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
            <strong>Each player picks 6 pros</strong> from the live field
            before round 1 tees off.
          </li>
          <li>
            <strong>Score updates round-by-round.</strong> Birdies +3,
            eagles +8, bogeys −1, doubles −3, plus finish-position bonuses
            on Sunday.
          </li>
          <li>
            <strong>Sweat the leaderboard</strong> all weekend. Trash-talk
            your friends in the league chat.
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
