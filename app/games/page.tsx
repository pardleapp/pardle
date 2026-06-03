import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { BRAND } from "@/lib/brand";
import {
  HUB_GAMES,
  HUB_CHALLENGE,
  HUB_AVATAR_PALETTE,
} from "../live/games-hub-data";
import TapDebugOverlay from "./TapDebugOverlay";

// Static — the game catalogue itself only changes on a deploy.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: `Games — ${BRAND.name}`,
  description:
    "Daily puzzles for golf fans. Guess today's mystery pro, identify famous holes from satellite, and more.",
};

/** /games — standalone page form of the v2 GamesHub, used as the
 *  destination for the off-week landing's "Sharpen up with a
 *  daily puzzle" card and any legacy bookmarks. Mirrors the
 *  GamesHub overlay's layout (streak banner + 2-col grid + crew
 *  challenge board + footer links), but renders in document flow
 *  rather than as a fixed overlay so it nests cleanly with the
 *  rest of the page chrome.
 *
 *  Replaces the pre-redesign dark hub (the legacy .hub layout
 *  that was breaking the design-source-of-truth rule by being
 *  the only dark page in the v2 flow). Wraps in .pv-theme so the
 *  body bg flips to warm paper (via the `:has(.pv-theme)` rule
 *  in globals.css) on the first paint — no useEffect race.
 */
export default function GamesPage() {
  return (
    <main className="pv-theme gh-page">
      <TapDebugOverlay />
      <header className="gh-head">
        <Link href="/" className="bd-pv-back" aria-label="Back home">
          ←
        </Link>
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
                { ["--gm-accent" as string]: g.accent } as CSSProperties
              }
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
          <Link href="/today" className="gm-foot-link">
            See how the world&rsquo;s playing →
          </Link>
          <Link
            href="/blend/me"
            className="gm-foot-link gm-foot-link-quiet"
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
    </main>
  );
}
