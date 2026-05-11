import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { todayDayNumber } from "@/lib/day-index";
import {
  readPerGameStats,
  STATS_GAMES,
  type GameDayStats,
  type StatsGameId,
} from "@/lib/stats-backend";

// Re-fetch from Redis every 2 minutes — fresh enough that the page
// feels alive, cheap enough that we comfortably stay inside Upstash's
// 500k command/month free tier.
export const revalidate = 120;

export const metadata: Metadata = {
  title: `${BRAND.name} — Today's stats`,
  description: "How well the rest of the world did on today's Pardle games.",
};

const GAME_META: Record<
  StatsGameId,
  { name: string; emoji: string; accent: string; maxScore: number }
> = {
  pros: { name: "Pros", emoji: "🏌️", accent: "#7BAE3F", maxScore: 6 },
  holes: { name: "Holes", emoji: "🛰️", accent: "#5BA0E0", maxScore: 6 },
  clubs: { name: "Clubhouses", emoji: "🏛️", accent: "#E0A85B", maxScore: 6 },
  connections: { name: "Connections", emoji: "🧩", accent: "#B388D6", maxScore: 4 },
  trivia: { name: "Trivia", emoji: "❓", accent: "#E8C547", maxScore: 10 },
};

function winRate(g: GameDayStats): number | null {
  if (g.total === 0) return null;
  return Math.round((g.wins / g.total) * 100);
}

function averageScore(g: GameDayStats): number | null {
  if (g.wins === 0) return null;
  let sum = 0;
  let count = 0;
  for (const [bucket, n] of Object.entries(g.distribution)) {
    if (bucket === "X") continue;
    sum += Number(bucket) * n;
    count += n;
  }
  if (count === 0) return null;
  return Math.round((sum / count) * 10) / 10;
}

function distributionMax(g: GameDayStats): number {
  return Math.max(1, ...Object.values(g.distribution));
}

export default async function TodayStatsPage() {
  const days = Object.fromEntries(
    STATS_GAMES.map((g) => [g, todayDayNumber(g)]),
  ) as Record<StatsGameId, number>;
  const allStats = await readPerGameStats(days);
  const statsByGame = new Map(allStats.map((s) => [s.game, s]));

  // Sort by popularity (most played first) so the most engaged game
  // leads the page.
  const results = STATS_GAMES.map((game) => ({
    meta: GAME_META[game],
    stats: statsByGame.get(game)!,
  })).sort((a, b) => b.stats.total - a.stats.total);

  const totalPlays = results.reduce((sum, r) => sum + r.stats.total, 0);

  return (
    <main className="container today-stats">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">How the world did today</p>
      </header>

      {totalPlays === 0 ? (
        <div className="today-empty">
          <p>No one&apos;s finished a puzzle yet today.</p>
          <p className="today-empty-cta">Be the first.</p>
          <div className="today-empty-buttons">
            {STATS_GAMES.map((game) => (
              <Link key={game} href={`/${game}`} className="today-game-cta">
                {GAME_META[game].emoji} {GAME_META[game].name}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="today-card-stack">
          <p className="today-summary">
            <strong>{totalPlays}</strong> puzzle
            {totalPlays === 1 ? "" : "s"} solved today across {BRAND.name}.
          </p>

          {results.map(({ meta, stats }) => {
            const wr = winRate(stats);
            const avg = averageScore(stats);
            const distMax = distributionMax(stats);
            return (
              <Link
                key={meta.name}
                href={`/${stats.game}`}
                className="today-card"
                style={{ borderColor: meta.accent }}
              >
                <div className="today-card-head">
                  <div className="today-card-name">
                    <span className="today-card-emoji">{meta.emoji}</span>
                    <span style={{ color: meta.accent }}>{meta.name}</span>
                  </div>
                  <div className="today-card-played">
                    {stats.total} played
                  </div>
                </div>

                <div className="today-card-rows">
                  <div className="today-stat-row">
                    <span className="today-stat-label">Solve rate</span>
                    <span className="today-stat-value">
                      {wr === null ? "—" : `${wr}%`}
                    </span>
                  </div>
                  {stats.game === "connections" ? (
                    <div className="today-stat-row">
                      <span className="today-stat-label">Avg mistakes</span>
                      <span className="today-stat-value">
                        {avg === null ? "—" : avg.toFixed(1)}
                      </span>
                    </div>
                  ) : (
                    <div className="today-stat-row">
                      <span className="today-stat-label">Avg guesses</span>
                      <span className="today-stat-value">
                        {avg === null ? "—" : avg.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Distribution bars */}
                {Object.keys(stats.distribution).length > 0 && (
                  <div className="today-dist">
                    {Array.from(
                      { length: meta.maxScore + 1 },
                      (_, i) => i,
                    ).map((bucket) => {
                      const count = stats.distribution[String(bucket)] ?? 0;
                      const width = (count / distMax) * 100;
                      return (
                        <div key={bucket} className="today-dist-row">
                          <span className="today-dist-label">{bucket}</span>
                          <span className="today-dist-bar-wrap">
                            <span
                              className="today-dist-bar"
                              style={{
                                width: `${Math.max(width, count > 0 ? 6 : 0)}%`,
                                background: meta.accent,
                              }}
                            />
                          </span>
                          <span className="today-dist-count">{count}</span>
                        </div>
                      );
                    })}
                    {stats.distribution["X"] > 0 && (
                      <div className="today-dist-row">
                        <span className="today-dist-label">X</span>
                        <span className="today-dist-bar-wrap">
                          <span
                            className="today-dist-bar today-dist-bar-loss"
                            style={{
                              width: `${Math.max(
                                (stats.distribution["X"] / distMax) * 100,
                                6,
                              )}%`,
                            }}
                          />
                        </span>
                        <span className="today-dist-count">
                          {stats.distribution["X"]}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      <footer>
        <p>
          {BRAND.domain} · Stats reset at midnight UTC · Anonymous, no
          personal data collected
        </p>
      </footer>
    </main>
  );
}
