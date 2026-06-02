import Link from "next/link";
import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import AuthChip from "./live/auth/AuthChip";
import MainNav from "./MainNav";

export const metadata: Metadata = {
  title: `Page not found — ${BRAND.name}`,
};

export default function NotFound() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>
          <Link href="/" className="brand-back">
            {BRAND.name}
          </Link>
        </h1>
        <div className="brand-nav">
          <MainNav active="none" />
          <AuthChip />
        </div>
      </header>
      <section className="error-shell">
        <p className="error-eyebrow">404</p>
        <h2 className="error-title">This page doesn&apos;t exist.</h2>
        <p className="error-body">
          The link might be wrong, or the page may have been renamed.
        </p>
        <div className="error-actions">
          <Link href="/" className="error-cta">
            Back to {BRAND.name}
          </Link>
          <Link href="/bets" className="error-cta-quiet">
            Bets
          </Link>
          <Link href="/leaderboard" className="error-cta-quiet">
            Leaderboard
          </Link>
        </div>
      </section>
    </main>
  );
}
