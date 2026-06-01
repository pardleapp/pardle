/**
 * /live/player/[id] — redesigned player surface (pass 8).
 *
 * Mock-data driven for now so the page renders instantly without
 * any server-side PGA Tour API calls. Name resolution and the rest
 * of the real-data wiring land in a follow-up alongside the
 * orchestrator + DataGolf integration.
 */

import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import PlayerPageClient from "./PlayerPageClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: `Player — ${BRAND.name}`,
  description: "Tournament scorecard, season form, recent shots.",
};

export default async function PlayerPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="container container-wide v4-theme pv-theme">
      <PlayerPageClient playerId={id} initialName={null} />
    </main>
  );
}
