import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import AuthChip from "../../auth/AuthChip";
import MainNav from "../../../MainNav";
import BetDetail from "./BetDetail";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

// Bet detail is loaded client-side from the visitor's localStorage —
// the server doesn't know what bet is being viewed. Render a generic
// page title rather than fetching from Supabase (which would only
// match the signed-in owner anyway, and shared bets go through the
// /share/bet/[id] route with its own richer metadata).
export const metadata: Metadata = {
  title: `Bet detail — ${BRAND.name}`,
  description:
    "Live PnL, fair value, and trajectory chart for one of your tracked bets.",
};

export default async function BetDetailPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="container container-wide v4-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="bets" />
          <AuthChip />
        </div>
      </header>

      <BetDetail betId={id} />
    </main>
  );
}
