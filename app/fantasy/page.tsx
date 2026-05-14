import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { getCurrentUser } from "@/lib/fantasy/auth";
import { getLeague, getLeaguesForUser } from "@/lib/fantasy/store";

export const metadata = {
  title: `${BRAND.name} Fantasy — daily fantasy golf with friends`,
  description:
    "Create a private fantasy golf league with up to 10 friends, pick 6 pros, and live-score every birdie, eagle and bogey through the tournament.",
};

// Force dynamic render — depends on session cookie.
export const dynamic = "force-dynamic";

export default async function FantasyHubPage() {
  const user = await getCurrentUser();
  const leagueIds = user ? await getLeaguesForUser(user.id) : [];
  const leagues = await Promise.all(leagueIds.map((id) => getLeague(id)));

  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Fantasy · friends-only golf pool</p>
      </header>

      {user ? (
        <section className="fantasy-hero">
          <h2 className="fantasy-hero-title">Hey {user.name.split(" ")[0]}</h2>
          <p className="fantasy-hero-sub">
            {leagues.length === 0
              ? "You're not in any leagues yet. Start one for your group or join with a code from a friend."
              : `You're in ${leagues.length} league${leagues.length === 1 ? "" : "s"}.`}
          </p>
          <div className="fantasy-cta-row">
            <Link href="/fantasy/create" className="fantasy-cta-primary">
              Create a league
            </Link>
            <Link href="/fantasy/join" className="fantasy-cta-secondary">
              Join with code
            </Link>
          </div>
        </section>
      ) : (
        <section className="fantasy-hero">
          <h2 className="fantasy-hero-title">Fantasy golf with your friends</h2>
          <p className="fantasy-hero-sub">
            Pick 6 pros before the tournament. Score points every round for
            birdies, eagles and bogeys. Top of the leaderboard wins bragging
            rights for the week.
          </p>
          <div className="fantasy-cta-row">
            <Link href="/fantasy/auth" className="fantasy-cta-primary">
              Sign in to play
            </Link>
          </div>
        </section>
      )}

      {leagues.length > 0 && (
        <section className="fantasy-leagues">
          <h3 className="fantasy-section-title">Your leagues</h3>
          <ul className="fantasy-league-list">
            {leagues.map((l) =>
              l ? (
                <li key={l.id}>
                  <Link
                    href={`/fantasy/league/${l.id}`}
                    className="fantasy-league-row"
                  >
                    <span className="fantasy-league-name">{l.name}</span>
                    <span className="fantasy-league-meta">
                      {l.memberIds.length} player
                      {l.memberIds.length === 1 ? "" : "s"} ·{" "}
                      {l.status === "draft"
                        ? "picks open"
                        : l.status === "locked"
                        ? "locked"
                        : "completed"}
                    </span>
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      )}

      <section className="fantasy-explain">
        <h3 className="fantasy-section-title">How it works</h3>
        <ol className="fantasy-steps">
          <li>
            <strong>Create a league</strong> for the upcoming tournament and
            invite up to 10 friends with a shareable link.
          </li>
          <li>
            <strong>Pick 6 pros across 4 tiers</strong> — 1 favourite (top 10),
            2 contenders (11–30), 2 outsiders (31–60), 1 dark horse (61+).
            Everyone picks before R1 tees off.
          </li>
          <li>
            <strong>Name a captain &amp; vice-captain.</strong> Your captain&apos;s
            points are doubled. If they miss the cut, your vice steps in.
          </li>
          <li>
            <strong>Nominate your double-round.</strong> Save R4 for a Sunday
            hero swing, or play it safe with R1. That round&apos;s birdies,
            eagles and bogeys count 2x — stacks with captain.
          </li>
          <li>
            <strong>Score updates round-by-round.</strong> Birdies +3,
            eagles +8, bogeys −1, doubles −3, plus finish-position bonuses
            on Sunday. Sweat the leaderboard and trash-talk in the league
            chat.
          </li>
        </ol>
      </section>

      <section className="fantasy-status">
        <p className="fantasy-status-note">
          🏗️ Fantasy is in beta and will launch in time for the{" "}
          <strong>US Open</strong> (June 18–21). Create a league now and
          we&apos;ll let you know the moment picks open.
        </p>
      </section>

      {user && (
        <form
          action="/api/fantasy/auth/logout"
          method="post"
          className="fantasy-signout-row"
        >
          <button type="submit" className="fantasy-signout-btn">
            Sign out ({user.email})
          </button>
        </form>
      )}
    </main>
  );
}
