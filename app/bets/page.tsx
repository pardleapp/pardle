/**
 * /bets — dedicated bet management surface. Hosts the bet tracker
 * (add bet, active bets, settled bets, totals, per-bet detail links)
 * separately from the live feed so /live can stay focused on the
 * social/shot-event side of the product.
 */

import { BRAND } from "@/lib/brand";
import HistoryClient from "../history/HistoryClient";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";
import BetsClient from "./BetsClient";

export const metadata = {
  title: `Your bets — ${BRAND.name}`,
  description:
    "Track your golf bets live: fair-value PnL, charts, settlement history.",
};

export const dynamic = "force-dynamic";

export default function BetsPage() {
  return (
    <main className="container container-wide v4-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="bets" />
          <AuthChip />
        </div>
      </header>
      <BetsClient />
      <HistoryClient hideList />
    </main>
  );
}
