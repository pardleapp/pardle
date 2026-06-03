/**
 * /groups/[id]/market — bet-detail view for a group-aggregated
 * market (player + market combination that ≥1 group members are
 * on). Opened from the "Most backed in your group" row.
 *
 * Why a separate route from /bets/[id]:
 *   - this is a market view, not a personal bet — there is no
 *     single bet row, just an aggregate (N members on R. Henley
 *     OUTRIGHT). The URL keys on (groupId, playerId, marketLabel)
 *     instead of a bet id.
 *   - the back arrow returns to /groups, not /bets.
 *
 * Data:
 *   - real backers + count come from getMostBacked(groupId), so the
 *     "X on it" avatars + N reflect actual group membership on the
 *     market.
 *   - win-% / trajectory / shot timeline come from the same source
 *     the personal bet tracker uses (mock for now — findMatching-
 *     MockBet matches on player last-name + market label), so the
 *     chart shown here is identical to what a member sees on their
 *     own tracked version of this bet. When the bet tracker swaps
 *     mock → real (model probability + odds pipeline), this surface
 *     will pick that up for free.
 *   - per-user stake is hidden; BetDetailClient's `isGroupView`
 *     branch already re-skins the eyebrow / tailers copy.
 */

import { notFound, redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getMostBacked, listMyGroups } from "@/lib/groups/server";
import {
  findMatchingMockBet,
  type MockBetLive,
} from "@/app/bets/mock-bets";
import BetDetailClient from "@/app/bets/[id]/BetDetailClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Group market — ${BRAND.name}`,
};

export default async function GroupMarketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ p?: string; m?: string }>;
}) {
  const { id: groupId } = await params;
  const { p: playerId, m: marketLabel } = await searchParams;
  if (!playerId || !marketLabel) notFound();

  // Auth + membership: redirect to /groups (which renders the sign-
  // in gate or the empty state) when the caller can't view this
  // group. listMyGroups respects RLS — non-members get an empty
  // list and we punt them out.
  const supabase = await getSupabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/groups");
  const groups = await listMyGroups();
  if (!groups.some((g) => g.id === groupId)) redirect("/groups");

  const rows = await getMostBacked(groupId);
  const row = rows.find(
    (r) => r.player_id === playerId && r.market_label === marketLabel,
  );
  if (!row) notFound();

  // Pull the matching mock for chart + win-% data so the trajectory
  // matches the personal bet tracker. Falls back to a neutral stub
  // when no candidate exists — page still renders, just with a flat
  // chart and dash odds.
  const match = findMatchingMockBet(row.player_name, row.market_label);
  const bet: MockBetLive = match
    ? {
        ...match,
        mine: false,
        who: row.player_name,
        mkt: row.market_label,
        on: row.backers.map((b) => b.initials),
        stake: 0,
      }
    : {
        id: `market:${playerId}:${marketLabel}`,
        who: row.player_name,
        mine: false,
        on: row.backers.map((b) => b.initials),
        mkt: row.market_label,
        cur: "£",
        stake: 0,
        odds: { dec: "—", frac: "—", am: "—" },
        prob: 50,
        dir: "up",
        hist: [50, 50],
        tl: [],
      };

  return (
    <main className="container container-wide v4-theme pv-theme">
      <BetDetailClient
        bet={bet}
        backFallback="/groups"
        backAriaLabel="Back to Groups"
      />
    </main>
  );
}
