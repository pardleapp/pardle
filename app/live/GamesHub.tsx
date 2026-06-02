"use client";

/**
 * GamesHub — overlay sheet opened from the games/controller icon in
 * the Sweat Feed header. Surfaces today's daily-puzzle hub: a
 * streak banner, a 2-col grid of game cards (Pros / Holes /
 * Clubhouses / Connections), and a crew challenge board with
 * today's scores.
 *
 * Matches design-handoff/Pardle Social v2.html → GamesHub
 * (lines 528–538) and social-v2.css gm-streak / gm-grid / gm-card
 * / gm-state styles (L515–524). Reuses the `.bd-pv-back` /
 * `.bd-pv-title` head treatment (already aligned to the
 * prototype's `.detail-back` / `.detail-title`) and the
 * `.racerow` rows already used by Groups.
 *
 * Cards navigate to the existing daily-puzzle routes (/pros,
 * /holes, /clubs, /connections). The streak banner and the
 * crew challenge board are stubbed for now — the existing
 * stats backend (lib/stats-backend) and Groups data will hydrate
 * them once we wire real state through.
 *
 * The daily puzzle is deterministic per UTC date — every user
 * sees the same puzzle today, derived from
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
  state: string;
  done: boolean;
}

const GAMES: Game[] = [
  {
    key: "pros",
    href: "/pros",
    ic: "⛳",
    name: "Pros",
    desc: "Guess today's mystery pro in 6",
    state: "Solved 4/6",
    done: true,
  },
  {
    key: "holes",
    href: "/holes",
    ic: "🏌️",
    name: "Holes",
    desc: "Name the famous hole",
    state: "Play",
    done: false,
  },
  {
    key: "clubs",
    href: "/clubs",
    ic: "🏟️",
    name: "Clubhouses",
    desc: "Spot the course",
    state: "Play",
    done: false,
  },
  {
    key: "conn",
    href: "/connections",
    ic: "🔗",
    name: "Connections",
    desc: "Find the four groups",
    state: "2 mistakes",
    done: true,
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
              onClick={onClose}
            >
              <div className="gm-ic" aria-hidden="true">
                {g.ic}
              </div>
              <div className="gm-nm">{g.name}</div>
              <div className="gm-desc">{g.desc}</div>
              <div
                className={`gm-state${g.done ? " gm-state-done" : ""}`}
              >
                {g.state}
              </div>
            </Link>
          ))}
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
