"use client";

/**
 * LeaderboardClientV2 — redesigned /leaderboard surface matching the
 * design-handoff prototype's <Leaderboard>. Mock-data driven for the
 * first cut; real wiring (live orchestrator leaderboard via
 * /api/feed) lands in a follow-up.
 *
 *   ● Live · Round 4 · Final
 *   Charles Schwab Challenge
 *
 *   [ Full field ] [ ★ Following ] [ Your bets ]
 *
 *   POS  PLAYER                 TODAY   TOTAL  THRU
 *   1   [RH] R. Henley   • OUTRIGHT  −4    −12   F   (highlighted)
 *   2   [EC] E. Cole                 −6    −12   F
 *   T3  [BG] B. Griffin •            −3    −11   17
 *   T3  [AS] A. Smalley   • TOP 5    −6    −11   F   (highlighted)
 *   ...
 *
 * Followed players get the orange .fdot dot beside the name; players
 * with a tracked bet get an emerald bettag chip + a soft "mine"
 * row highlight. Each row taps through to /live/player/[name].
 *
 * Copy guardrail: "Live" only on the event line — no
 * latency / refresh figures.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LEADERBOARD,
  EVENT_LINE,
  TOURNAMENT_NAME,
} from "./mock-leaderboard";

type Filter = "all" | "following" | "bets";

/** Two-letter initials from the player's last name —
 *  "R. Henley" → "HE", "B. Griffin" → "GR", "M. Meissner" → "ME".
 *  Always derives from the name so the leaderboard never falls back
 *  to a "?" placeholder image while we're still on mock data. */
function lastNameInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  const last = parts[parts.length - 1];
  return last.slice(0, 2).toUpperCase();
}

/** Gradient based on the initials so each player's avatar is
 *  distinct + stable across renders. */
const PALETTE: Array<[string, string]> = [
  ["#6b7df2", "#c659d8"],
  ["#f29a4f", "#d44a4a"],
  ["#56b0e8", "#3a4f9b"],
  ["#5cd7c1", "#1f8b6e"],
  ["#e87f9e", "#a23676"],
  ["#a070ff", "#3b1f8a"],
  ["#ffb35a", "#c4691a"],
  ["#85d4f7", "#1f6b9e"],
  ["#ed7a99", "#7a274d"],
  ["#7be0ad", "#26795a"],
];
function gradientFor(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function Headshot({ name, photo }: { name: string; photo?: string }) {
  // Initials + per-player gradient is the always-on baseline so a
  // row never shows a bare circle. When a `photo` URL is supplied
  // it stacks on top (covers the initials on load) and falls back
  // to the initials on broken image via the .lb-av img CSS rule.
  // Real PGA headshot URLs wire in once /leaderboard reads from
  // /api/feed; mock-only mode passes no photo and shows initials.
  const initials = lastNameInitials(name);
  const [from, to] = gradientFor(initials);
  const [photoFailed, setPhotoFailed] = useState(false);
  return (
    <span
      className="lb-av"
      aria-hidden="true"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <span className="lb-av-init">{initials}</span>
      {photo && !photoFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          onError={() => setPhotoFailed(true)}
        />
      )}
    </span>
  );
}

export default function LeaderboardClientV2() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");

  const rows = LEADERBOARD.filter((r) => {
    if (filter === "following") return r.following;
    if (filter === "bets") return r.bet !== "";
    return true;
  });

  const openPlayer = (name: string) => {
    router.push(`/live/player/${encodeURIComponent(name)}`);
  };

  return (
    <section className="lb-pv">
      <header className="lb-head">
        <div className="lb-head-ev">
          <i aria-hidden="true" />
          Live · {EVENT_LINE}
        </div>
        <h2 className="lb-head-title">{TOURNAMENT_NAME}</h2>
      </header>

      <div className="lb-filter" role="tablist" aria-label="Leaderboard filter">
        <button
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          className={filter === "all" ? "on" : ""}
          onClick={() => setFilter("all")}
        >
          Full field
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "following"}
          className={filter === "following" ? "on" : ""}
          onClick={() => setFilter("following")}
        >
          ★ Following
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "bets"}
          className={filter === "bets" ? "on" : ""}
          onClick={() => setFilter("bets")}
        >
          Your bets
        </button>
      </div>

      <div className="lb-cols">
        <span>Pos</span>
        <span />
        <span>Player</span>
        <span className="lb-col-num">Today</span>
        <span className="lb-col-num">Total</span>
        <span className="lb-col-num">Thru</span>
      </div>

      <ul className="lb-list">
        {rows.length === 0 ? (
          <li className="lb-empty">
            {filter === "following"
              ? "You're not following anyone on the leaderboard yet — tap a player to follow them."
              : "No tracked bets on the leaderboard yet."}
          </li>
        ) : (
          rows.map((r, i) => {
            const totalIsOver = r.total.startsWith("+");
            return (
              <li
                key={`${r.pos}-${r.name}-${i}`}
                className={`lb-row${r.bet ? " lb-row-mine" : ""}`}
              >
                <button
                  type="button"
                  className="lb-row-btn"
                  onClick={() => openPlayer(r.name)}
                  aria-label={`${r.name} ${r.total} thru ${r.thru}`}
                >
                  <span className="lb-pos">{r.pos}</span>
                  <Headshot name={r.name} />
                  <div className="lb-name-block">
                    <div className="lb-name-line">
                      <span className="lb-nm-text">{r.name}</span>
                      {r.following && (
                        <span className="fdot" aria-label="Following" />
                      )}
                    </div>
                    {r.bet && (
                      <div className="lb-tag-line">
                        <span className="bettag">{r.bet}</span>
                      </div>
                    )}
                  </div>
                  <span className={`lb-td lb-td-${r.dir}`}>{r.today}</span>
                  <span className={`lb-tot${totalIsOver ? " lb-tot-over" : ""}`}>
                    {r.total}
                  </span>
                  <span className="lb-thru">{r.thru}</span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
