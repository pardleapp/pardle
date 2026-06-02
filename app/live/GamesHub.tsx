"use client";

/**
 * GamesHub — overlay sheet opened from the games/controller icon in
 * the Sweat Feed header. Surfaces today's daily-puzzle hub: a
 * streak banner, a 2-col grid of game cards, a crew challenge
 * board, and footer links.
 *
 * Layout reconciled against design-handoff/Pardle Social v2.html →
 * GamesHub (lines 528–538) and social-v2.css `.gm-streak` /
 * `.gm-grid` / `.gm-card` / `.gm-state` (L515–524) + the detail-
 * head pattern reused via `.bd-pv-back` / `.bd-pv-title`.
 *
 * Game LIST is the real lineup from the repo, NOT the prototype's
 * placeholder set (which still had "Clubhouses" — cut before the
 * redesign). The five live games are pros / holes / connections /
 * trivia / faces, mirroring `STATS_GAMES` in lib/stats-backend.
 * Blurbs and accent colours are taken verbatim from the existing
 * pre-redesign hub at app/games/page.tsx so this overlay is a
 * style refresh of the SAME game catalogue. Trivia and Faces are
 * multiplayer (get the MULTIPLAYER pill).
 *
 * Two footer actions sit below the grid:
 *   - "See how the world's playing →"   → /today
 *   - "🪄 Blend yourself with a PGA pro →"  → /blend/me
 *
 * Daily puzzles are deterministic per UTC date (CLAUDE.md):
 * `daysSinceEpoch % puzzleCount`. This hub presents the existing
 * engine; no game logic is reimplemented here.
 */

import Link from "next/link";

interface GamesHubProps {
  open: boolean;
  onClose: () => void;
}

interface Game {
  key: string;
  href: string;
  ic: string;
  name: string;
  desc: string;
  /** Per-game accent colour — surfaced as a top stripe on the
   *  card so each game reads as distinct without breaking the
   *  light .pv theme. Hex matches app/games/page.tsx GAMES[]. */
  accent: string;
  /** Multiplayer games (trivia, faces) get the MULTIPLAYER pill
   *  in the card header — same affordance the pre-redesign hub
   *  carried. */
  multiplayer?: boolean;
}

/** Mirrors the real `app/games/page.tsx` lineup. Sourced from
 *  what actually ships, not the prototype's placeholder list. */
const GAMES: Game[] = [
  {
    key: "pros",
    href: "/pros",
    ic: "🏌️",
    name: "Pros",
    desc: "Six guesses to identify today's mystery golfer.",
    accent: "#7BAE3F",
  },
  {
    key: "holes",
    href: "/holes",
    ic: "🛰️",
    name: "Holes",
    desc: "Identify today's golf course from a satellite view.",
    accent: "#5BA0E0",
  },
  {
    key: "connections",
    href: "/connections",
    ic: "🧩",
    name: "Connections",
    desc: "Find four groups of four. Every item has a golf connection.",
    accent: "#B388D6",
  },
  {
    key: "trivia",
    href: "/trivia",
    ic: "❓",
    name: "Trivia",
    desc: "10 golf trivia questions. Easy, medium, or hard.",
    accent: "#E8C547",
    multiplayer: true,
  },
  {
    key: "faces",
    href: "/faces",
    ic: "👥",
    name: "Faces",
    desc: "Six blended-face puzzles. Name both pros in each.",
    accent: "#E07B5B",
    multiplayer: true,
  },
];

const GAME_CHALLENGE: Array<{
  initials: string;
  name: string;
  score: string;
}> = [
  { initials: "JO", name: "Jordan", score: "3/6" },
  { initials: "MI", name: "Mia", score: "5/6" },
  { initials: "YO", name: "You", score: "4/6" },
  { initials: "TH", name: "Theo", score: "X" },
];

const AV_PALETTE: Record<string, string> = {
  JO: "linear-gradient(135deg,#5cd7c1,#1f8b6e)",
  MI: "linear-gradient(135deg,#ed7a99,#7a274d)",
  YO: "linear-gradient(135deg,#ffb35a,#c4691a)",
  TH: "linear-gradient(135deg,#6b7df2,#c659d8)",
};

export default function GamesHub({ open, onClose }: GamesHubProps) {
  if (!open) return null;
  return (
    <div className="gh" role="dialog" aria-modal="true" aria-label="Daily games">
      <header className="gh-head">
        <button
          type="button"
          className="bd-pv-back"
          onClick={onClose}
          aria-label="Close games"
        >
          ←
        </button>
        <div className="bd-pv-title">
          <div className="bd-pv-title-nm">Daily games</div>
          <div className="bd-pv-title-mk">
            Free to play · challenge your crew
          </div>
        </div>
      </header>
      <div className="gh-body">
        <div className="gm-streak">
          🔥 <b>12-day</b> streak · play today&rsquo;s to keep it alive
        </div>
        <div className="gm-grid">
          {GAMES.map((g) => (
            <Link
              key={g.key}
              href={g.href}
              className="gm-card"
              style={
                { ["--gm-accent" as string]: g.accent } as React.CSSProperties
              }
              onClick={onClose}
            >
              <span
                className="gm-stripe"
                aria-hidden="true"
                style={{ background: g.accent }}
              />
              {g.multiplayer && (
                <span className="gm-mp">MULTIPLAYER</span>
              )}
              <div className="gm-ic" aria-hidden="true">
                {g.ic}
              </div>
              <div className="gm-nm">{g.name}</div>
              <div className="gm-desc">{g.desc}</div>
              <div className="gm-state">Play today →</div>
            </Link>
          ))}
        </div>
        <div className="gm-foot">
          <Link href="/today" className="gm-foot-link" onClick={onClose}>
            See how the world&rsquo;s playing →
          </Link>
          <Link
            href="/blend/me"
            className="gm-foot-link gm-foot-link-quiet"
            onClick={onClose}
          >
            🪄 Blend yourself with a PGA pro →
          </Link>
        </div>
        <section className="gh-sec">
          <h4 className="gh-sec-title">Today&rsquo;s Pros · The Lads</h4>
          <div className="gh-board">
            {GAME_CHALLENGE.map((r, i) => (
              <div
                key={r.initials}
                className={`racerow${r.name === "You" ? " racerow-you" : ""}`}
              >
                <span className="racerow-rk">{i + 1}</span>
                <span
                  className="gh-av"
                  style={{ background: AV_PALETTE[r.initials] }}
                  aria-hidden="true"
                >
                  {r.initials}
                </span>
                <span className="racerow-nm">
                  {r.name === "You" ? <b>You</b> : r.name}
                </span>
                <span
                  className={`gh-score${r.score === "X" ? " gh-score-x" : ""}`}
                >
                  {r.score}
                </span>
              </div>
            ))}
          </div>
          <button type="button" className="gh-challenge-btn">
            Challenge your crew ↗
          </button>
        </section>
      </div>
    </div>
  );
}
