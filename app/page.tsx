import Link from "next/link";
import { BRAND } from "@/lib/brand";
import FeedClient from "./live/FeedClient";

export const metadata = {
  title: `${BRAND.name} — Live bet tracker + tournament feed`,
  description:
    "Track your golf bets live, see fair value tick every minute, and watch the tournament alongside other bettors.",
};

export const dynamic = "force-dynamic";

export default function HomeLive() {
  return (
    <main className="container container-wide">
      <header className="brand">
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Live · bets & feed</p>
        <nav className="hub-nav-tabs" aria-label="Section">
          <Link
            href="/"
            className="hub-nav-tab hub-nav-tab-active"
            aria-current="page"
          >
            Live feed
          </Link>
          <Link href="/games" className="hub-nav-tab">
            Games
          </Link>
        </nav>
      </header>
      <FeedClient />
    </main>
  );
}
