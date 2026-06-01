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
import { pgaTourHeadshotUrlById } from "@/lib/data/pga-tour-ids";
import {
  LEADERBOARD,
  EVENT_LINE,
  TOURNAMENT_NAME,
} from "./mock-leaderboard";

type Filter = "all" | "following" | "bets";

function Headshot({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  // Mock data is keyed by name, not by PGA id — try the headshot
  // lookup with the name-derived initials as a best-effort URL slot
  // and fall back to a gradient + initials. Real wiring threads
  // playerId through here.
  const initials = name
    .split(" ")
    .pop()
    ?.slice(0, 2)
    .toUpperCase() ?? "PP";
  const headshot = pgaTourHeadshotUrlById(name, 60);
  return (
    <span className="lb-av" aria-hidden="true">
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={headshot} alt="" onError={() => setFailed(true)} />
      ) : (
        <span className="lb-av-init">{initials}</span>
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
        <span className="lb-col-pos">Pos</span>
        <span className="lb-col-av" />
        <span className="lb-col-nm">Player</span>
        <span className="lb-col-td">Today</span>
        <span className="lb-col-tot">Total</span>
        <span className="lb-col-thru">Thru</span>
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
                  <span className="lb-nm">
                    <span className="lb-nm-text">{r.name}</span>
                    {r.following && <span className="fdot" aria-label="Following" />}
                    {r.bet && <span className="bettag">{r.bet}</span>}
                  </span>
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
