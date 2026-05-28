"use client";

/**
 * End-of-game "what else to play" strip. Drop this into any
 * daily game's finish screen and it surfaces the other daily
 * games as compact CTAs — mirrors the Netflix "if you liked X,
 * try Y" pattern so a finished session funnels into another
 * play instead of ending dead.
 *
 * Static list — same shape as `app/games/page.tsx` GAMES — so
 * the component stays self-contained and doesn't depend on
 * server data. Order is consistent across games and we shuffle
 * which 3 we show based on the caller's `current` id (skip the
 * one they just played).
 */

import Link from "next/link";
import type { CSSProperties } from "react";

export type GameId =
  | "pros"
  | "holes"
  | "connections"
  | "trivia"
  | "faces";

interface GameTile {
  id: GameId;
  href: string;
  name: string;
  blurb: string;
  emoji: string;
  accent: string;
}

const GAMES: GameTile[] = [
  {
    id: "pros",
    href: "/pros",
    name: "Pros",
    blurb: "Guess today's mystery golfer in 6 tries.",
    emoji: "🏌️",
    accent: "#7BAE3F",
  },
  {
    id: "holes",
    href: "/holes",
    name: "Holes",
    blurb: "Name today's course from a satellite view.",
    emoji: "🛰️",
    accent: "#5BA0E0",
  },
  {
    id: "connections",
    href: "/connections",
    name: "Connections",
    blurb: "Group sixteen golf terms into four sets.",
    emoji: "🧩",
    accent: "#B388D6",
  },
  {
    id: "trivia",
    href: "/trivia",
    name: "Trivia",
    blurb: "Ten golf questions — easy to hard.",
    emoji: "❓",
    accent: "#E8C547",
  },
  {
    id: "faces",
    href: "/faces",
    name: "Faces",
    blurb: "Identify both pros in six blended faces.",
    emoji: "👥",
    accent: "#E07B5B",
  },
];

interface Props {
  /** The game the user just finished — excluded from the
   *  suggestion list. */
  current: GameId;
  /** Heading text shown above the tile grid. Defaults to
   *  "Play another". */
  heading?: string;
}

export default function PlayAnother({
  current,
  heading = "Play another",
}: Props) {
  const others = GAMES.filter((g) => g.id !== current);
  if (others.length === 0) return null;
  return (
    <section className="play-another" aria-label={heading}>
      <h3 className="play-another-title">{heading}</h3>
      <ul className="play-another-list">
        {others.map((g) => (
          <li key={g.id}>
            <Link
              href={g.href}
              className="play-another-tile"
              style={{ "--accent": g.accent } as CSSProperties}
            >
              <span className="play-another-emoji" aria-hidden="true">
                {g.emoji}
              </span>
              <span className="play-another-text">
                <span className="play-another-name">{g.name}</span>
                <span className="play-another-blurb">{g.blurb}</span>
              </span>
              <span className="play-another-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
