import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/fantasy/auth";
import {
  createLeague,
  LeagueError,
} from "@/lib/fantasy/league-ops";
import { getOrInitNextTournament } from "@/lib/fantasy/tournament-ops";

/**
 * POST /api/fantasy/league/create
 *
 * Form-encoded body:
 *   name        — league name (1-60 chars)
 *   displayName — what shows on this league's leaderboard (optional)
 *
 * Anonymously: 401. Otherwise: creates a league for the upcoming PGA
 * Tour event and 303-redirects to /fantasy/league/{id}.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(
      `${new URL(req.url).origin}/fantasy/auth?error=missing`,
      { status: 303 },
    );
  }

  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const displayName =
    String(form.get("displayName") ?? "").trim() || undefined;

  if (!name) {
    return NextResponse.redirect(
      `${new URL(req.url).origin}/fantasy/create?error=bad-name`,
      { status: 303 },
    );
  }

  const tournament = await getOrInitNextTournament();

  try {
    const league = await createLeague({
      name,
      tournamentId: tournament.id,
      creator: user,
      displayName,
    });
    return NextResponse.redirect(
      `${new URL(req.url).origin}/fantasy/league/${league.id}`,
      { status: 303 },
    );
  } catch (err) {
    if (err instanceof LeagueError) {
      return NextResponse.redirect(
        `${new URL(req.url).origin}/fantasy/create?error=${err.code}`,
        { status: 303 },
      );
    }
    throw err;
  }
}
