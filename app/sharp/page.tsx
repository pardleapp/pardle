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

        {qualified.length === 0 ? (
          <p className="feed-empty" style={{ padding: 32 }}>
            No qualified callers yet. Vote on a few putt-polls during
            the next tournament to start building your record.
          </p>
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
