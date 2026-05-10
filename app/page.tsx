import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND.name} — Daily golf puzzles`,
  description:
    "Daily puzzles for golf fans. Guess today's mystery pro, identify famous holes from satellite, and more.",
};

interface GameTile {
  href: string;
  name: string;
  blurb: string;
  emoji: string;
  status: "live" | "soon";
  accent: string;
}

const GAMES: GameTile[] = [
  {
    href: "/pros",
    name: "Pros",
    blurb: "Six guesses to identify today's mystery golfer.",
    emoji: "🏌️",
    status: "live",
    accent: "#7BAE3F",
  },
  {
    href: "/holes",
    name: "Holes",
    blurb: "Spot today's hole from a satellite view. Easy / medium / hard.",
    emoji: "🛰️",
    status: "soon",
    accent: "#5BA0E0",
  },
  {
    href: "/clubs",
    name: "Clubs",
    blurb: "Name the clubhouse from the photo.",
    emoji: "🏛️",
    status: "soon",
    accent: "#E0A85B",
  },
];

function tileStyle(accent: string): CSSProperties {
  return { "--accent": accent } as CSSProperties;
}

function CardBody({ game }: { game: GameTile }) {
  return (
    <>
      <div className="hub-card-emoji">{game.emoji}</div>
      <div className="hub-card-name">{game.name}</div>
      <p className="hub-card-blurb">{game.blurb}</p>
      {game.status === "live" ? (
        <span className="hub-card-cta">Play today →</span>
      ) : (
        <span className="hub-card-status">Coming soon</span>
      )}
    </>
  );
}

export default function HubHome() {
  return (
    <main className="hub">
      <header className="hub-header">
        <h1 className="hub-wordmark">{BRAND.name}</h1>
        <p className="hub-subtitle">Daily golf puzzles</p>
      </header>

      <div className="hub-grid">
        {GAMES.map((game) =>
          game.status === "live" ? (
            <Link
              key={game.href}
              href={game.href}
              className="hub-card hub-card-live"
              style={tileStyle(game.accent)}
            >
              <CardBody game={game} />
            </Link>
          ) : (
            <div
              key={game.href}
              className="hub-card hub-card-soon"
              style={tileStyle(game.accent)}
            >
              <CardBody game={game} />
            </div>
          ),
        )}
      </div>

      <footer className="hub-footer">
        <p>
          {BRAND.domain} · A daily-puzzle hub for golf nerds. New games rolling
          out.
        </p>
      </footer>
    </main>
  );
}
