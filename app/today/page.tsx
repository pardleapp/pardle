import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { todayDayNumber } from "@/lib/day-index";
import {
  GAME_VARIANTS,
  readPerGameStats,
  STATS_GAMES,
  type GameDayStats,
  type StatsGameId,
} from "@/lib/stats-backend";
import { VariantStatsCard } from "./_components/VariantStatsCard";

const VARIANT_LABELS: Record<string, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

// Re-fetch from Redis every 2 minutes — fresh enough that the page
// feels alive, cheap enough that we comfortably stay inside Upstash's
// 500k command/month free tier.
export const revalidate = 120;

export const metadata: Metadata = {
  title: `${BRAND.name} — Today's stats`,
  description: "How well the rest of the world did on today's Pardle games.",
};

// "clubs" stays in the record as a stub so the StatsGameId Record type
// is satisfied, but it never renders — STATS_GAMES doesn't include it,
// so the iteration in this page skips it entirely.
const GAME_META: Record<
  StatsGameId,
  { name: string; emoji: string; accent: string; maxScore: number }
> = {
  pros: { name: "Pros", emoji: "🏌️", accent: "#7BAE3F", maxScore: 6 },
  holes: { name: "Holes", emoji: "🛰️", accent: "#5BA0E0", maxScore: 6 },
  clubs: { name: "Clubhouses", emoji: "🏛️", accent: "#E0A85B", maxScore: 6 },
  connections: { name: "Connections", emoji: "🧩", accent: "#B388D6", maxScore: 4 },
  trivia: { name: "Trivia", emoji: "❓", accent: "#E8C547", maxScore: 10 },
  faces: { name: "Faces", emoji: "👥", accent: "#E07B5B", maxScore: 12 },
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

  // Group stats by game so variant games (trivia easy/med/hard) get one
  // entry that holds all variants together. Single-variant games keep
  // a one-element list.
  type GameGroup = {
    game: StatsGameId;
    meta: typeof GAME_META[StatsGameId];
    stats: GameDayStats[];
    totalAcross: number;
  };
  const grouped: GameGroup[] = STATS_GAMES.map((game) => {
    const stats = allStats.filter((s) => s.game === game);
    return {
      game,
      meta: GAME_META[game],
      stats,
      totalAcross: stats.reduce((sum, s) => sum + s.total, 0),
    };
  }).sort((a, b) => b.totalAcross - a.totalAcross);

  const totalPlays = grouped.reduce((sum, g) => sum + g.totalAcross, 0);

  return (
    <main className="container today-stats pv-theme">
      <header className="brand">
        <Link className="brand-back" href="/games" aria-label="All games">
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

          {grouped.map(({ game, meta, stats: variantStats }) => {
            const variants = GAME_VARIANTS[game];
            // Multi-variant game (e.g. trivia easy/medium/hard) — render
            // the dedicated client component with a tab toggle.
            if (variants && variants.length > 1) {
              const initial =
                variantStats
                  .slice()
                  .sort((a, b) => b.total - a.total)[0]?.variant ??
                variants[0];
              return (
                <VariantStatsCard
                  key={game}
                  game={game}
                  meta={meta}
                  initialVariantId={initial}
                  variants={variants.map((vId) => {
                    const found = variantStats.find((s) => s.variant === vId);
                    return {
                      id: vId,
                      label: VARIANT_LABELS[vId] ?? vId,
                      stats:
                        found ?? {
                          game,
                          variant: vId,
                          total: 0,
                          wins: 0,
                          distribution: {},
                        },
                    };
                  })}
                />
              );
            }

            // Single-variant game — same inline rendering as before.
            const stats = variantStats[0] ?? {
              game,
              total: 0,
              wins: 0,
              distribution: {} as Record<string, number>,
            };
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
