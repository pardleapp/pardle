import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { getCurrentUser } from "@/lib/fantasy/auth";
import {
  getLeague,
  getTournament,
  listMembershipsForLeague,
} from "@/lib/fantasy/store";
import { MAX_LEAGUE_MEMBERS } from "@/lib/fantasy/types";
import InviteShareBox from "./InviteShareBox";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LeaguePage({ params }: PageProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/fantasy/auth`);
  }

  const league = await getLeague(id);
  if (!league) notFound();

  const isMember = league.memberIds.includes(user.id);
  if (!isMember) {
    // Not a member — bounce them to the join page with code pre-filled.
    redirect(`/fantasy/join?code=${encodeURIComponent(league.inviteCode)}`);
  }

  const [tournament, memberships] = await Promise.all([
    getTournament(league.tournamentId),
    listMembershipsForLeague(league),
  ]);

  const myMembership = memberships.find((m) => m.userId === user.id);
  const picksMade = myMembership?.picks.length ?? 0;
  const totalPicks =
    league.tierBreakdown.A +
    league.tierBreakdown.B +
    league.tierBreakdown.C +
    league.tierBreakdown.D;

  const inviteUrl = `${BRAND.url}/fantasy/join?code=${league.inviteCode}`;

  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/fantasy" aria-label="Back to fantasy">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Fantasy · {league.name}</p>
      </header>

      <section className="fantasy-hero">
        <h2 className="fantasy-hero-title">{league.name}</h2>
        {tournament ? (
          <p className="fantasy-hero-sub">
            Playing for <strong>{tournament.name}</strong> · {tournament.course}
            <br />
            {tournament.startDate} → {tournament.endDate}
          </p>
        ) : (
          <p className="fantasy-hero-sub">
            Loading tournament info…
          </p>
        )}
      </section>

      {league.status === "draft" && (
        <section className="fantasy-pick-status">
          {picksMade === 0 ? (
            <>
              <h3 className="fantasy-section-title">Your picks</h3>
              <p className="fantasy-status-note">
                You haven&apos;t picked yet. Choose {totalPicks} pros, a
                captain &amp; vice, and your double-round before R1 tees off.
              </p>
              <Link
                href={`/fantasy/league/${league.id}/picks`}
                className="fantasy-cta-primary"
                style={{ display: "inline-block", marginTop: 12 }}
              >
                Make your picks
              </Link>
            </>
          ) : (
            <>
              <h3 className="fantasy-section-title">Your picks</h3>
              <p className="fantasy-status-note">
                {picksMade}/{totalPicks} picks set.
                {myMembership?.picksLockedAt
                  ? " Locked in. Good luck!"
                  : " Tap to finish."}
              </p>
              <Link
                href={`/fantasy/league/${league.id}/picks`}
                className="fantasy-cta-secondary"
                style={{ display: "inline-block", marginTop: 12 }}
              >
                {myMembership?.picksLockedAt ? "View picks" : "Edit picks"}
              </Link>
            </>
          )}
        </section>
      )}

      <section className="fantasy-leagues">
        <h3 className="fantasy-section-title">
          Members ({memberships.length}/{MAX_LEAGUE_MEMBERS})
        </h3>
        <ul className="fantasy-member-list">
          {memberships.map((m) => (
            <li key={m.userId} className="fantasy-member-row">
              <span className="fantasy-member-name">
                {m.displayName}
                {m.userId === user.id && (
                  <span className="fantasy-member-you"> · you</span>
                )}
                {m.userId === league.createdByUserId && (
                  <span className="fantasy-member-host"> · host</span>
                )}
              </span>
              <span className="fantasy-member-meta">
                {m.picksLockedAt
                  ? "locked"
                  : m.picks.length > 0
                  ? `${m.picks.length}/${totalPicks} picks`
                  : "no picks"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="fantasy-leagues">
        <h3 className="fantasy-section-title">Invite friends</h3>
        <InviteShareBox
          inviteCode={league.inviteCode}
          inviteUrl={inviteUrl}
          leagueName={league.name}
        />
      </section>
    </main>
  );
}
