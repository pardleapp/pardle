/**
 * /bets/[id] — bet detail surface, redesigned to match the design-
 * handoff prototype's <BetDetail> overlay. Renders mock data for
 * now (looked up from app/bets/mock-bets.ts) so the visual is exact
 * before we wire to the real bet store + reconstructed prob history.
 *
 * Server component; the interactive chart + share / comment input
 * live in the client child component.
 */

import { notFound } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { MOCK_BETS_LIVE } from "../mock-bets";
import BetDetailClient from "./BetDetailClient";

export const metadata = {
  title: `Bet detail — ${BRAND.name}`,
};

export default async function BetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bet = MOCK_BETS_LIVE.find((b) => b.id === id);
  if (!bet) notFound();
  return (
    <main className="container container-wide v4-theme pv-theme">
      <BetDetailClient bet={bet} />
    </main>
  );
}
