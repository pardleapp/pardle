/**
 * /api/odds-compare/debug
 *
 * Discovery endpoint — dumps DK's raw offer-category tree for the
 * active tournament so I can see exactly what subcategory names
 * DK uses for round-score O/U markets on THIS tournament.
 * Delete once the parser is reliable.
 */

import { NextResponse } from "next/server";
import { getActiveTournament } from "@/lib/golf-api/pgatour";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/123.0.0.0 Safari/537.36";
const BASE = "https://sportsbook-nash.draftkings.com/api/sportscontent/dkusva";

export async function GET() {
  const active = await getActiveTournament();
  const name = active?.tournament?.name ?? null;
  if (!name) {
    return NextResponse.json({ ok: false, error: "no active tournament" });
  }
  const leagueRes = await fetch(`${BASE}/v1/leagues/9`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!leagueRes.ok) {
    return NextResponse.json({
      ok: false,
      stage: "league",
      status: leagueRes.status,
      body: (await leagueRes.text()).slice(0, 500),
    });
  }
  const league = (await leagueRes.json()) as {
    eventGroups?: { eventGroupId: number; eventGroupName: string }[];
  };
  const target = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = (league.eventGroups ?? []).find((g) => {
    const norm = g.eventGroupName.toLowerCase().replace(/[^a-z0-9]/g, "");
    return norm.includes(target) || target.includes(norm);
  });
  if (!match) {
    return NextResponse.json({
      ok: false,
      stage: "match",
      tournamentName: name,
      availableEventGroups: (league.eventGroups ?? []).map((g) => g.eventGroupName),
    });
  }
  const egRes = await fetch(`${BASE}/v1/eventgroups/${match.eventGroupId}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!egRes.ok) {
    return NextResponse.json({
      ok: false,
      stage: "eventGroup",
      status: egRes.status,
      body: (await egRes.text()).slice(0, 500),
    });
  }
  const eg = (await egRes.json()) as {
    eventGroup?: {
      offerCategories?: {
        categoryId: number;
        name: string;
        offerSubcategoryDescriptors?: {
          subcategoryId: number;
          name: string;
          offers?: {
            label?: string;
            outcomes?: { label?: string; oddsAmerican?: string }[];
          }[][];
        }[];
      }[];
    };
  };
  const summary = (eg.eventGroup?.offerCategories ?? []).map((cat) => ({
    category: cat.name,
    subcategories: (cat.offerSubcategoryDescriptors ?? []).map((sub) => {
      // Grab a sample offer + first two outcomes so I can see the
      // label shape without dumping tens of KB.
      const firstOfferGroup = (sub.offers ?? [])[0];
      const firstOffer = firstOfferGroup?.[0];
      return {
        name: sub.name,
        offerCount: (sub.offers ?? []).reduce((a, g) => a + g.length, 0),
        sampleOfferLabel: firstOffer?.label ?? null,
        sampleOutcomes: (firstOffer?.outcomes ?? [])
          .slice(0, 4)
          .map((o) => ({ label: o.label, oddsAmerican: o.oddsAmerican })),
      };
    }),
  }));
  return NextResponse.json({
    ok: true,
    tournamentName: name,
    eventGroupId: match.eventGroupId,
    eventGroupName: match.eventGroupName,
    categories: summary,
  });
}
