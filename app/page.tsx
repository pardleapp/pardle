import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { getGolfHeadlines } from "@/lib/golf-news";
import { NewsTicker } from "@/app/_components/NewsTicker";
import { WelcomeModal } from "@/app/_components/WelcomeModal";
import { todayDayNumber } from "@/lib/day-index";
import {
  readPerGameStats,
  STATS_GAMES,
  type GameDayStats,
  type StatsGameId,
} from "@/lib/stats-backend";

// Hub revalidates every 2 minutes so the per-card 'today's stats'
// numbers stay fresh enough to feel live, without re-hitting the
// upstream news feed or Redis on every visitor.
export const revalidate = 120;

export const metadata: Metadata = {
  title: `${BRAND.name} — Daily golf puzzles`,
  description:
    "Daily puzzles for golf fans. Guess today's mystery pro, identify famous holes from satellite, and more.",
};

interface GameTile {
  id: StatsGameId;
  href: string;
  name: string;
  blurb: string;
  emoji: string;
  status: "live" | "soon";
  accent: string;
  /** Optional badge shown on the card (e.g. 'Multiplayer'). */
  tag?: string;
}

const GAMES: GameTile[] = [
  {
    id: "pros",
    href: "/pros",
    name: "Pros",
    blurb: "Six guesses to identify today's mystery golfer.",
    emoji: "🏌️",
    status: "live",
    accent: "#7BAE3F",
  },
  {
    id: "holes",
    href: "/holes",
    name: "Holes",
    blurb: "Identify today's golf course from a satellite view.",
    emoji: "🛰️",
    status: "live",
    accent: "#5BA0E0",
  },
  {
    id: "clubs",
    href: "/clubs",
    name: "Clubhouses",
    blurb: "Name the course from its clubhouse silhouette.",
    emoji: "🏛️",
    status: "live",
    accent: "#E0A85B",
  },
  {
    id: "connections",
    href: "/connections",
    name: "Connections",
    blurb: "Find four groups of four. Every item has a golf connection.",
    emoji: "🧩",
    status: "live",
    accent: "#B388D6",
  },
  {
    id: "trivia",
    href: "/trivia",
    name: "Trivia",
    blurb: "10 golf trivia questions. Easy, medium, or hard.",
    emoji: "❓",
    status: "live",
    accent: "#E8C547",
    tag: "Multiplayer",
  },
  {
    id: "faces",
    href: "/faces",
    name: "Faces",
    blurb: "Six blended-face puzzles. Name both pros in each.",
    emoji: "👥",
    status: "live",
    accent: "#E07B5B",
    tag: "Multiplayer",
  },
];

function tileStyle(accent: string): CSSProperties {
  return { "--accent": accent } as CSSProperties;
}

function statsLine(stats: GameDayStats | undefined): string | null {
  if (!stats || stats.total === 0) return null;
  const rate = Math.round((stats.wins / stats.total) * 100);
  return `${stats.total} played today · ${rate}% solved`;
}

function CardBody({
  game,
  stats,
}: {
  game: GameTile;
  stats: GameDayStats | undefined;
}) {
  const line = statsLine(stats);
  return (
    <>
      {game.tag && <span className="hub-card-tag">{game.tag}</span>}
      <div className="hub-card-emoji">{game.emoji}</div>
      <div className="hub-card-name">{game.name}</div>
      <p className="hub-card-blurb">{game.blurb}</p>
      {line && <p className="hub-card-stats">{line}</p>}
      {game.status === "live" ? (
        <span className="hub-card-cta">Play today →</span>
      ) : (
        <span className="hub-card-status">Coming soon</span>
      )}
    </>
  );
}

export default async function HubHome() {
  const [headlines, statsList] = await Promise.all([
    getGolfHeadlines(),
    readPerGameStats(
      Object.fromEntries(
        STATS_GAMES.map((g) => [g, todayDayNumber(g)]),
      ) as Record<StatsGameId, number>,
    ).catch(() => [] as GameDayStats[]),
  ]);
  const statsByGame = new Map(statsList.map((s) => [s.game, s]));
  const totalToday = statsList.reduce((sum, s) => sum + s.total, 0);

  return (
    <main className="hub">
      <WelcomeModal />

      <header className="hub-header">
        <h1 className="hub-wordmark">{BRAND.name}</h1>
        <p className="hub-subtitle">Daily golf puzzles</p>
      </header>

      <NewsTicker headlines={headlines} />

      <div className="hub-grid">
        {GAMES.map((game) =>
          game.status === "live" ? (
            <Link
              key={game.href}
              href={game.href}
              className="hub-card hub-card-live"
              style={tileStyle(game.accent)}
            >
              <CardBody game={game} stats={statsByGame.get(game.id)} />
            </Link>
          ) : (
            <div
              key={game.href}
              className="hub-card hub-card-soon"
              style={tileStyle(game.accent)}
            >
              <CardBody game={game} stats={statsByGame.get(game.id)} />
            </div>
          ),
        )}
      </div>

      <Link href="/today" className="hub-stats-link">
        See how the world&apos;s playing →
        {totalToday > 0 && (
          <span className="hub-stats-link-count">{totalToday} today</span>
        )}
      </Link>

      <footer className="hub-footer">
        <p>{BRAND.domain} · A daily-puzzle hub for golf nerds.</p>
        <p>
          <a
            className="hub-footer-link"
            href={`mailto:${BRAND.email}?subject=Pardle%20feedback`}
          >
            Contact us
          </a>
        </p>
      </footer>
    </main>
  );
}
