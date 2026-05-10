import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND.name} — Holes (coming soon)`,
  description:
    "Spot today's golf hole from a satellite view. Coming soon to Pardle.",
};

export default function HolesComingSoon() {
  return (
    <main className="coming-soon">
      <Link href="/" className="back-link">
        ← All games
      </Link>
      <div className="coming-soon-emoji">🛰️</div>
      <h1>Holes</h1>
      <p className="coming-soon-tagline">
        Spot today&apos;s famous golf hole from a satellite view.
      </p>
      <p className="coming-soon-blurb">
        Easy / medium / hard difficulty. Drop a pin on a world map or type the
        course + hole number. Coming soon.
      </p>
      <Link href="/pros" className="coming-soon-cta">
        Play Pardle: Pros while you wait →
      </Link>
    </main>
  );
}
