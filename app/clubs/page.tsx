import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND.name} — Clubs (coming soon)`,
  description:
    "Identify the clubhouse from a single photo. Coming soon to Pardle.",
};

export default function ClubsComingSoon() {
  return (
    <main className="coming-soon">
      <Link href="/" className="back-link">
        ← All games
      </Link>
      <div className="coming-soon-emoji">🏛️</div>
      <h1>Clubs</h1>
      <p className="coming-soon-tagline">
        Name the clubhouse from a single photo.
      </p>
      <p className="coming-soon-blurb">
        From Augusta to Royal Dornoch. Coming soon.
      </p>
      <Link href="/pros" className="coming-soon-cta">
        Play Pardle: Pros while you wait →
      </Link>
    </main>
  );
}
