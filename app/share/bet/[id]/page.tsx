import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { TrackedBet } from "@/app/live/bet-shared";
import SharedBetView from "./SharedBetView";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface BetRow {
  id: string;
  user_id: string;
  kind: string;
  data: Record<string, unknown>;
  placed_at: string;
}

async function loadShare(id: string): Promise<{
  bet: TrackedBet;
  ownerName: string;
} | null> {
  // Use the anon-context server client so RLS protects us — even if
  // our is_public filter has a bug, the policy denies the read for
  // non-public bets.
  const supabase = await getSupabaseServer();
  const res = await supabase
    .from("bets")
    .select("id, user_id, kind, data, placed_at")
    .eq("id", id)
    .eq("is_public", true)
    .is("removed_at", null)
    .maybeSingle();
  const row = res.data as BetRow | null;
  if (!row) return null;
  // Strip authorKey before exposing to anonymous visitors — the bet
  // author's cookie identity travelled with the JSON blob for bets
  // placed before we added the dedicated author_key column, and we
  // don't want it leaking on every share link. Defence-in-depth:
  // the POST handler now also strips it on the way in, so this is
  // for the legacy rows.
  const data = row.data as Record<string, unknown>;
  const { authorKey: _stripped, ...safeData } = data;
  void _stripped;
  const bet = {
    ...safeData,
    id: row.id,
    kind: row.kind,
    placedAt: new Date(row.placed_at).getTime(),
  } as TrackedBet;
  const profileRes = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", row.user_id)
    .maybeSingle();
  const profile = profileRes.data as { display_name: string | null } | null;
  const ownerName = profile?.display_name?.trim() || "A Pardle user";
  return { bet, ownerName };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const share = await loadShare(id);
  if (!share) return { title: `${BRAND.name} · Bet` };
  const summary = describeBet(share.bet);
  return {
    title: `${share.ownerName}'s bet · ${BRAND.name}`,
    description: summary,
    openGraph: {
      title: `${share.ownerName}'s bet on Pardle`,
      description: summary,
      type: "website",
    },
    twitter: {
      card: "summary",
      title: `${share.ownerName}'s bet on Pardle`,
      description: summary,
    },
  };
}

function describeBet(bet: TrackedBet): string {
  if (bet.kind === "outright") {
    return `Outright winner — ${bet.playerName} @ ${bet.oddsTakenLabel}, stake £${bet.stake}.`;
  }
  if (bet.kind === "round-score") {
    const round = bet.round != null ? ` R${bet.round}` : "";
    return `Round score${round} — ${bet.playerName} ${bet.side} ${bet.line} @ ${bet.oddsTakenLabel}.`;
  }
  if (bet.kind === "winning-score") {
    return `Winning score — ${bet.side} ${bet.line} @ ${bet.oddsTakenLabel}.`;
  }
  if (bet.kind === "top-finish") {
    return `Top ${bet.cutoff} — ${bet.playerName} @ ${bet.oddsTakenLabel}.`;
  }
  return "A live bet on Pardle.";
}

export const dynamic = "force-dynamic";

export default async function SharedBetPage({ params }: PageProps) {
  const { id } = await params;
  const share = await loadShare(id);
  if (!share) notFound();

  return (
    <main className="container container-wide">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="Go to Pardle">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">{share.ownerName}&apos;s bet</p>
      </header>
      <SharedBetView bet={share.bet} ownerName={share.ownerName} />
    </main>
  );
}
