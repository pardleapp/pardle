/**
 * /sharp — public leaderboard ranked by Sharp Score (accuracy across
 * every prediction a user has made: putt-polls, bet outcomes,
 * pre-round picks, pre-tournament outright/cut calls).
 *
 * Sits alongside Feed / Bets / Leaderboard / Course / Players in
 * the main nav as the dedicated credibility surface — the place
 * where "who's actually sharp" is settled, not just claimed.
 */

import Link from "next/link";
import { BRAND } from "@/lib/brand";
import {
  getSharpScore,
  getTopSharpCallers,
  SHARP_MIN_CALLS,
} from "@/lib/feed/sharp-score";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";
import MySharpCard from "./MySharpCard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Sharp Score leaderboard — ${BRAND.name}`,
  description:
    "Who's actually sharp on Pardle? Accuracy across every prediction — putt-polls, bet outcomes, pre-round picks. Top callers ranked by correct calls this season.",
};

export default async function SharpLeaderboardPage() {
  const rows = await getTopSharpCallers(50);
  // Pull each top-N user's Sharp Score so we can show accuracy +
  // total calls. Cheap — 6 Redis reads per row, all parallel.
  const enriched = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      score: await getSharpScore(r.authorKey),
    })),
  );
  const qualified = enriched.filter((r) => r.score.qualified);

  return (
    <main className="container container-wide v4-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="sharp" />
          <AuthChip />
        </div>
      </header>

      <section className="sharp-page">
        <div className="sharp-page-head">
          <h2 className="sharp-page-title">Sharp Score</h2>
          <p className="sharp-page-blurb">
            Accuracy across every prediction you make on Pardle —
            putt-polls, bet outcomes, pre-round picks, pre-tournament
            calls. The higher the score, the more you&apos;ve been
            right. Need at least {SHARP_MIN_CALLS} settled calls to
            qualify.
          </p>
        </div>

        <MySharpCard minCalls={SHARP_MIN_CALLS} />

        {qualified.length === 0 ? (
          <div className="sharp-empty">
            <h3 className="sharp-empty-title">
              How to build your Sharp Score
            </h3>
            <ol className="sharp-empty-steps">
              <li>
                <strong>Vote on putt-polls</strong> during live rounds —
                each call counts toward your record once the putt
                resolves.
              </li>
              <li>
                <strong>Log bets you&apos;ve placed</strong> on the bet
                tracker — settled outright, top-finish and round-score
                bets all credit your score.
              </li>
              <li>
                Hit {SHARP_MIN_CALLS} settled calls to qualify for the
                leaderboard. Your accuracy chip lights up green when
                you&apos;re above the field average.
              </li>
            </ol>
            <div className="sharp-empty-ctas">
              <Link href="/" className="sharp-empty-cta">
                Open the live feed →
              </Link>
              <Link href="/bets" className="sharp-empty-cta-quiet">
                Log a bet you&apos;ve placed
              </Link>
            </div>
          </div>
        ) : (
          <ol className="sharp-list">
            {qualified.map((r, i) => (
              <li key={r.authorKey} className="sharp-row">
                <span className="sharp-row-rank">{i + 1}</span>
                <span className="sharp-row-name">
                  {r.displayName ?? "Anonymous"}
                </span>
                <span className="sharp-row-acc">
                  {Math.round(r.score.accuracy * 100)}%
                </span>
                <span className="sharp-row-calls">
                  {r.score.correct}/{r.score.total} calls
                </span>
                {r.score.currentStreak >= 3 && (
                  <span
                    className="sharp-row-streak"
                    title={`${r.score.currentStreak} correct in a row`}
                  >
                    🔥 {r.score.currentStreak}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}

        <p className="sharp-page-footnote">
          <Link href="/leaderboard/polls" className="sharp-page-link">
            See Putt-IQ leaderboard →
          </Link>
        </p>
      </section>
    </main>
  );
}
