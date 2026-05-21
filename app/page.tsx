import { BRAND } from "@/lib/brand";
import FeedClient from "./live/FeedClient";
import AuthChip from "./live/auth/AuthChip";
import MainNav from "./MainNav";

export const metadata = {
  title: `${BRAND.name} — Live bet tracker + tournament feed`,
  description:
    "Track your golf bets live, see fair value tick every minute, and watch the tournament alongside other bettors.",
};

export const dynamic = "force-dynamic";

export default function HomeLive() {
  return (
    <main className="container container-wide v4-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="live" />
          <AuthChip />
        </div>
      </header>
      <FeedClient />
    </main>
  );
}
