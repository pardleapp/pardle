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
    blurb:
      "Spot today's hole from a satellite view. Easy / medium / hard.",
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

export default function HubHome() {
  return (
    <main className="hub">
      <header className="hub-header">
        <h1 className="hub-wordmark">{BRAND.name}</h1>
        <p className="hub-subtitle">Daily golf puzzles</p>
      </header>

      <div className="hub-grid">
        {GAMES.map((game) => {
          const isLive = game.status === "live";
          const Card = isLive ? Link : "div";
          return (
            <Card
              key={game.href}
              {...(isLive ? { href: game.href } : {})}
              className={`hub-card hub-card-${game.status}`}
              style={
                {
                  "--accent": game.accent,
                } as React.CSSProperties
              }
            >
              <div className="hub-card-emoji">{game.emoji}</div>
              <div className="hub-card-name">{game.name}</div>
              <p className="hub-card-blurb">{game.blurb}</p>
              {isLive ? (
                <span className="hub-card-cta">Play today →</span>
              ) : (
                <span className="hub-card-status">Coming soon</span>
              )}
            </Card>
          );
        })}
      </div>

      <footer className="hub-footer">
        <p>
          {BRAND.domain} · A daily-puzzle hub for golf nerds. New games
          rolling out.
        </p>
      </footer>
    </main>
  );
}
