import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/fantasy/auth";
import {
  joinLeagueByCode,
  LeagueError,
} from "@/lib/fantasy/league-ops";

/**
 * POST /api/fantasy/league/join
 *
 * Form-encoded body:
 *   code        — 6-char invite code (case-insensitive)
 *   displayName — what shows on this league's leaderboard (optional)
 *
 * Anonymously: redirect to sign-in. Otherwise: joins and redirects to
 * /fantasy/league/{id}.
 */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/fantasy/auth?error=missing`, {
      status: 303,
    });
  }

  const form = await req.formData();
  const code = String(form.get("code") ?? "").trim();
  const displayName =
    String(form.get("displayName") ?? "").trim() || undefined;

  if (!code) {
    return NextResponse.redirect(`${origin}/fantasy/join?error=bad-invite`, {
      status: 303,
    });
  }

  try {
    const league = await joinLeagueByCode({
      inviteCode: code,
      user,
      displayName,
    });
    return NextResponse.redirect(
      `${origin}/fantasy/league/${league.id}`,
      { status: 303 },
    );
  } catch (err) {
    if (err instanceof LeagueError) {
      return NextResponse.redirect(
        `${origin}/fantasy/join?error=${err.code}`,
        { status: 303 },
      );
    }
    throw err;
  }
}
