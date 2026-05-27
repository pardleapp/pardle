import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND } from "@/lib/brand";
import {
  getActiveTournament,
  getLeaderboard,
  getSchedule,
  getScorecards,
  type PGALeaderboardRow,
  type PGAScorecard,
} from "@/lib/golf-api/pgatour";
import seasonRoundsRaw from "@/lib/data/season-rounds.json";
import { bulkResolveEventIds } from "@/lib/feed/historical-cache";
import { getPlayerReelRows } from "@/lib/feed/player-rows";
import { getRecentFormByName } from "@/lib/feed/recent-form";
import { getRecentHoles } from "@/lib/feed/recent-holes";
import { derivePlayerStats } from "@/lib/feed/scorecard-stats";
import type { SeasonRoundsEntry } from "@/lib/feed/season-rounds";
import { resultFor } from "@/lib/feed/types";
import FollowButton from "../../FollowButton";
import PlayerHighlights from "../../PlayerHighlights";
import PlayerRecentForm from "../../PlayerRecentForm";
import PlayerSeasonView from "../../PlayerSeasonView";
import PlayerStats from "../../PlayerStats";
import RecentHoles from "../../RecentHoles";

export const dynamic = "force-dynamic";

const SEASON_DATA = seasonRoundsRaw as Record<string, SeasonRoundsEntry>;

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

/** Lowercase + strip non-alphanumeric — same scheme season-rounds.json
 *  is keyed by. Used to translate a player's display name into the
 *  key needed to look them up in our local datasets. */
function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve a player's display name from their orchestrator playerId
 * by checking the live tournament's leaderboard, then falling back
 * to the most recently completed tournament's leaderboard. Returns
 * null when the player can't be found in either.
 *
 * Pulls the active leaderboard concurrently with the scorecard
 * fetch (above) — that's the in-tournament case. The fallback path
 * (no active leaderboard hit) is the between-events case where the
 * page would previously have 404'd.
 */
async function resolveNameFromLast(
  id: string,
): Promise<{ name: string; tournamentId: string } | null> {
  try {
    const { completed } = await getSchedule();
    const mostRecent = completed
      .filter((t) => t.startDate <= Date.now())
      .sort((a, b) => b.startDate - a.startDate)[0];
    if (!mostRecent) return null;
    const lb = await getLeaderboard(mostRecent.id);
    const row = lb.find((r) => r.playerId === id);
    if (!row) return null;
    return { name: row.displayName, tournamentId: mostRecent.id };
  } catch {
    return null;
  }
}

export default async function PlayerPage({ params }: PageProps) {
  const { id } = await params;

  // Try the live path first — when a tournament's on AND the player
  // is in the field, we get scorecard + leaderboard data alongside
  // the name.
  const active = await getActiveTournament().catch(() => null);
  let row: PGALeaderboardRow | undefined;
  let scorecard: PGAScorecard | undefined;
  let reelRows: { best: Awaited<ReturnType<typeof getPlayerReelRows>>["best"]; worst: Awaited<ReturnType<typeof getPlayerReelRows>>["worst"] } = {
    best: [],
    worst: [],
  };
  const liveTournament =
    active && active.isLive ? active.tournament : null;
  if (liveTournament) {
    const [leaderboard, scorecards, reels] = await Promise.all([
      getLeaderboard(liveTournament.id),
      getScorecards(liveTournament.id, [id]),
      getPlayerReelRows(liveTournament.id, id),
    ]);
    row = leaderboard.find((r) => r.playerId === id);
    scorecard = scorecards[id];
    reelRows = reels;
  }

  // Resolve the player's name. Live path provides it directly; off-
  // week falls back to the most recently completed leaderboard.
  let playerName = row?.displayName ?? "";
  if (!playerName) {
    const fallback = await resolveNameFromLast(id);
    if (fallback) playerName = fallback.name;
  }
  if (!playerName) notFound();

  const recentForm = getRecentFormByName(playerName);
  const eventIdMap = recentForm
    ? await bulkResolveEventIds(
        recentForm.recent.map((r) => ({
          tournament: r.tournament,
          year: r.season,
        })),
      )
    : {};

  // Season-stats fallback: look up by normalised name in
  // season-rounds.json so the page is always useful even between
  // tournaments. Only renders when we have data for this player
  // (most active PGA Tour players, missing for low-volume / non-
  // PGA pros).
  const seasonEntry = SEASON_DATA[normaliseName(playerName)] ?? null;

  // Live sections (scorecard, in-tournament stats, recent holes,
  // highlights reel) only render when a tournament is on AND the
  // player has scorecard data. Otherwise we show the season view
  // alone.
  const stats =
    liveTournament && scorecard ? derivePlayerStats(scorecard) : null;
  const hasLiveData =
    !!liveTournament && !!scorecard && !!stats && stats.rounds.length > 0;
  const recentHoles = liveTournament
    ? await getRecentHoles(liveTournament.id, id, scorecard, row?.thru)
    : [];

  return (
    <main className="container container-wide v4-theme">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="Back to feed">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">
          {hasLiveData ? "Live · player" : "Player profile"}
        </p>
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

      <PlayerRecentForm
        recent={recentForm?.recent ?? []}
        playerId={id}
        playerName={playerName}
        eventIdMap={eventIdMap}
      />

      {hasLiveData && (
        <>
          <PlayerHighlights best={reelRows.best} worst={reelRows.worst} />

          <RecentHoles holes={recentHoles} />

          <PlayerStats
            tournamentId={liveTournament!.id}
            playerName={playerName}
            playedRounds={stats!.rounds.map((r) => r.round)}
          />

          <section className="pcard-section">
            <h3 className="fantasy-section-title">Scorecard</h3>
            <div className="pcard-scroll">
              {stats!.rounds.map((rs) => {
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
                          {h.score === "" || h.score === "-" ? "" : h.score}
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
                <span className="pcard-stat-num">{stats!.totalBirdies}</span>
                <span className="pcard-stat-lbl">Birdies</span>
              </div>
              <div className="pcard-stat-box">
                <span className="pcard-stat-num">{stats!.totalEagles}</span>
                <span className="pcard-stat-lbl">Eagles</span>
              </div>
              <div className="pcard-stat-box">
                <span className="pcard-stat-num">{stats!.totalBogeys}</span>
                <span className="pcard-stat-lbl">Bogeys</span>
              </div>
              <div className="pcard-stat-box">
                <span className="pcard-stat-num">{stats!.totalDoubles}</span>
                <span className="pcard-stat-lbl">Doubles+</span>
              </div>
              <div className="pcard-stat-box">
                <span className="pcard-stat-num">
                  {stats!.bestRound ?? "—"}
                </span>
                <span className="pcard-stat-lbl">Best round</span>
              </div>
              <div className="pcard-stat-box">
                <span className="pcard-stat-num">
                  {stats!.scoringAvg !== null
                    ? stats!.scoringAvg.toFixed(1)
                    : "—"}
                </span>
                <span className="pcard-stat-lbl">Scoring avg</span>
              </div>
            </div>
          </section>
        </>
      )}

      {seasonEntry && (
        <PlayerSeasonView
          entry={seasonEntry}
          recentForm={recentForm}
          heading={hasLiveData ? "2026 season" : undefined}
        />
      )}

      {!hasLiveData && !seasonEntry && (
        <p className="feed-empty" style={{ padding: 14 }}>
          No season data on file for {playerName} yet.
        </p>
      )}
    </main>
  );
}
