import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND } from "@/lib/brand";
import {
  getActiveTournament,
  getLeaderboard,
  getScorecards,
} from "@/lib/golf-api/pgatour";
import { getPlayerReelRows } from "@/lib/feed/player-rows";
import { getRecentHoles } from "@/lib/feed/recent-holes";
import { derivePlayerStats } from "@/lib/feed/scorecard-stats";
import { resultFor } from "@/lib/feed/types";
import FollowButton from "../../FollowButton";
import PlayerHighlights from "../../PlayerHighlights";
import RecentHoles from "../../RecentHoles";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Map a result to the scorecard cell class. */
function cellClass(score: string, par: number): string {
  if (score === "" || score === "-") return "pcard-cell-empty";
  const s = Number(score);
  if (!Number.isFinite(s)) return "pcard-cell-empty";
  const r = resultFor(s, par);
  if (r === "eagle" || r === "albatross") return "pcard-cell-eagle";
  if (r === "birdie") return "pcard-cell-birdie";
  if (r === "bogey") return "pcard-cell-bogey";
  if (r === "double" || r === "triple-plus") return "pcard-cell-double";
  return "pcard-cell-par";
}

export default async function PlayerPage({ params }: PageProps) {
  const { id } = await params;
  const active = await getActiveTournament();
  if (!active) notFound();

  const { tournament } = active;
  const [leaderboard, scorecards, reelRows] = await Promise.all([
    getLeaderboard(tournament.id),
    getScorecards(tournament.id, [id]),
    getPlayerReelRows(tournament.id, id),
  ]);

  const row = leaderboard.find((r) => r.playerId === id);
  const scorecard = scorecards[id];
  if (!row && !scorecard) notFound();

  const playerName = row?.displayName ?? "Player";
  const stats = scorecard
    ? derivePlayerStats(scorecard)
    : null;
  const recentHoles = await getRecentHoles(
    tournament.id,
    id,
    scorecard,
    row?.thru,
  );

  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/live" aria-label="Back to feed">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Live · player</p>
      </header>

      <section className="pcard-head">
        <div className="pcard-head-top">
          <h2 className="pcard-name">{playerName}</h2>
          <FollowButton playerId={id} playerName={playerName} />
        </div>
        {row && (
          <div className="pcard-statline">
            <span className="pcard-stat">
              <strong>{row.position}</strong> pos
            </span>
            <span className="pcard-stat">
              <strong>{row.total}</strong> total
            </span>
            <span className="pcard-stat">
              <strong>{row.thru}</strong> thru
            </span>
            {row.currentRound && (
              <span className="pcard-stat">
                <strong>R{row.currentRound}</strong>
              </span>
            )}
          </div>
        )}
      </section>

      <PlayerHighlights best={reelRows.best} worst={reelRows.worst} />

      <RecentHoles holes={recentHoles} />

      {stats && stats.rounds.length > 0 ? (
        <>
          <section className="pcard-section">
            <h3 className="fantasy-section-title">Scorecard</h3>
            <div className="pcard-scroll">
              {stats.rounds.map((rs) => {
                const holes = scorecard!.rounds[rs.round] ?? [];
                return (
                  <div key={rs.round} className="pcard-round">
                    <div className="pcard-round-label">
                      <span className="pcard-round-num">R{rs.round}</span>
                      <span className="pcard-round-topar">
                        {rs.toPar === null
                          ? "—"
                          : rs.toPar === 0
                          ? "E"
                          : rs.toPar > 0
                          ? `+${rs.toPar}`
                          : rs.toPar}
                      </span>
                    </div>
                    <div className="pcard-holes">
                      {holes.map((h) => (
                        <span
                          key={h.holeNumber}
                          className={`pcard-cell ${cellClass(h.score, h.par)}`}
                          title={`Hole ${h.holeNumber} · par ${h.par}`}
                        >
                          {h.score === "" || h.score === "-"
                            ? ""
                            : h.score}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="pcard-section">
            <h3 className="fantasy-section-title">Tournament stats</h3>
            <div className="pcard-stat-grid">
              <div className="pcard-stat-box">
                <span className="pcard-stat-num">{stats.totalBirdies}</span>
                <span className="pcard-stat-lbl">Birdies</span>
              </div>
              <div className="pcard-stat-box">
                <span className="pcard-stat-num">{stats.totalEagles}</span>
                <span className="pcard-stat-lbl">Eagles</span>
              </div>
              <div className="pcard-stat-box">
                <span className="pcard-stat-num">{stats.totalBogeys}</span>
                <span className="pcard-stat-lbl">Bogeys</span>
              </div>
              <div className="pcard-stat-box">
                <span className="pcard-stat-num">{stats.totalDoubles}</span>
                <span className="pcard-stat-lbl">Doubles+</span>
              </div>
              <div className="pcard-stat-box">
                <span className="pcard-stat-num">
                  {stats.bestRound ?? "—"}
                </span>
                <span className="pcard-stat-lbl">Best round</span>
              </div>
              <div className="pcard-stat-box">
                <span className="pcard-stat-num">
                  {stats.scoringAvg !== null
                    ? stats.scoringAvg.toFixed(1)
                    : "—"}
                </span>
                <span className="pcard-stat-lbl">Scoring avg</span>
              </div>
            </div>
          </section>
        </>
      ) : (
        <p className="feed-empty">
          No scorecard yet — {playerName} hasn&apos;t teed off.
        </p>
      )}
    </main>
  );
}
