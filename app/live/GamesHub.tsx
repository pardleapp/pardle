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
import {
  HUB_GAMES,
  HUB_CHALLENGE,
  HUB_AVATAR_PALETTE,
} from "./games-hub-data";
import { useDismissibleOverlay } from "@/app/_hooks/useDismissibleOverlay";

interface GamesHubProps {
  open: boolean;
  onClose: () => void;
}

export default function GamesHub({ open, onClose }: GamesHubProps) {
  useDismissibleOverlay(open, onClose);
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
          {HUB_GAMES.map((g) => (
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
            {HUB_CHALLENGE.map((r, i) => (
              <div
                key={r.initials}
                className={`racerow${r.name === "You" ? " racerow-you" : ""}`}
              >
                <span className="racerow-rk">{i + 1}</span>
                <span
                  className="gh-av"
                  style={{ background: HUB_AVATAR_PALETTE[r.initials] }}
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
