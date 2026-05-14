import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `Create a league — ${BRAND.name} Fantasy`,
};

export default function FantasyCreatePage() {
  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/fantasy" aria-label="Back to fantasy">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Fantasy · create a league</p>
      </header>

      <div className="fantasy-status">
        <p className="fantasy-status-note">
          🏗️ League creation lands next. Right now we&apos;re wiring up
          live scoring from DataGolf and magic-link sign-in. Check back
          this weekend.
        </p>
      </div>

      <Link href="/fantasy" className="fantasy-cta-secondary" style={{ display: "block", marginTop: 16 }}>
        ← Back
      </Link>
    </main>
  );
}
