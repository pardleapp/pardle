import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `Join a league — ${BRAND.name} Fantasy`,
};

export default function FantasyJoinPage() {
  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/fantasy" aria-label="Back to fantasy">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Fantasy · join a league</p>
      </header>

      <div className="fantasy-status">
        <p className="fantasy-status-note">
          🏗️ Got a 6-character league code from a friend? The join flow
          lands alongside the create page once auth is wired. Your friend
          should send a direct link soon — just tap it then to join.
        </p>
      </div>

      <Link href="/fantasy" className="fantasy-cta-secondary" style={{ display: "block", marginTop: 16 }}>
        ← Back
      </Link>
    </main>
  );
}
