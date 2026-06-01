"use client";

/**
 * RaceSheet — drop-down sheet showing the full P&L race for The
 * Lads. Today / Season / All-time toggle. Matches the design-
 * handoff prototype's <RaceSheet>.
 *
 *   The Lads · P&L race
 *   9 members · live from your tracked bets
 *
 *   [ Today ]  [ Season ]  [ All-time ]
 *
 *   1  JO  Jordan 👑                       +£312
 *   2  YO  You                             +£186
 *   3  TH  Theo                            +£54
 *   4  SA  Sam                             −£20
 *   5  MI  Mia                             −£40
 *
 *   Tap a member to see their open bets · or
 *   🏆 = weekly group wins · all-time net  (alltime range only)
 */

import { useState } from "react";
import { RACE } from "./mock-groups";

interface Props {
  onClose: () => void;
}

const PALETTE: Record<string, string> = {
  JO: "linear-gradient(135deg,#5cd7c1,#1f8b6e)",
  SA: "linear-gradient(135deg,#f29a4f,#d44a4a)",
  TH: "linear-gradient(135deg,#6b7df2,#c659d8)",
  MI: "linear-gradient(135deg,#ed7a99,#7a274d)",
  YO: "linear-gradient(135deg,#ffb35a,#c4691a)",
};
function bgFor(initials: string): string {
  return PALETTE[initials] ?? "linear-gradient(135deg,#6b7df2,#3b1f8a)";
}

type RangeKey = "today" | "season" | "alltime";

export default function RaceSheet({ onClose }: Props) {
  const [range, setRange] = useState<RangeKey>("today");
  const rows = RACE[range];
  return (
    <div
      className="race-sheet"
      onClick={onClose}
      role="dialog"
      aria-label="P&L race"
    >
      <div
        className="race-card"
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        <h3>The Lads · P&amp;L race</h3>
        <div className="race-sub">9 members · live from your tracked bets</div>
        <div className="race-range" role="tablist" aria-label="Range">
          {(
            [
              ["today", "Today"],
              ["season", "Season"],
              ["alltime", "All-time"],
            ] as Array<[RangeKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={range === key}
              className={range === key ? "on" : ""}
              onClick={() => setRange(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="race-list">
          {rows.map((r, i) => (
            <div
              key={r.name}
              className={`racerow${r.name === "You" ? " racerow-you" : ""}`}
            >
              <span className="racerow-rk">{i + 1}</span>
              <span
                className="crew-mini-av"
                style={{
                  width: 32,
                  height: 32,
                  fontSize: 11,
                  background: bgFor(r.initials),
                }}
                aria-hidden="true"
              >
                {r.initials}
              </span>
              <span className="racerow-nm">
                {r.name === "You" ? <b>You</b> : r.name}
                {i === 0 && " 👑"}
                {range === "alltime" && (r.trophies ?? 0) > 0 && (
                  <span className="race-trophy">
                    {"🏆".repeat(r.trophies ?? 0)}
                  </span>
                )}
              </span>
              <span className={`racerow-pl ${r.dir}`}>{r.pl}</span>
            </div>
          ))}
        </div>
        <div className="race-foot">
          {range === "alltime"
            ? "🏆 = weekly group wins · all-time net"
            : "Tap a member to see their open bets"}
        </div>
      </div>
    </div>
  );
}
