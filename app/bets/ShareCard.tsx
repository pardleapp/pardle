"use client";

/**
 * ShareCard — polished, screenshot-ready light card the user can
 * save / send when they cash a tracked bet. Matches the design-
 * handoff prototype's <ShareCard>:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  Par[dle]               CHARLES SCHWAB · R4  │
 *   │                                              │
 *   │  ▲ BET WON                                   │
 *   │  +£500                                       │
 *   │                                              │
 *   │  R. Henley · OUTRIGHT WIN · £200 @ 3.50     │
 *   │  [Tracked shot-by-shot]                      │
 *   │  [2nd in The Lads] [+£226 today]             │
 *   │                                              │
 *   │  PARDLE.APP                                  │
 *   └──────────────────────────────────────────────┘
 *
 *   [ Save image ] [ Share to group ]
 *
 * Copy stays Pardle-only — no third-party odds source names, no
 * latency / refresh figures, per CLAUDE.md.
 */

import { useState } from "react";
import type { SettlementData } from "./SettlementModal";
import { useDismissibleOverlay } from "@/app/_hooks/useDismissibleOverlay";

interface Props {
  data: SettlementData;
  onClose: () => void;
  /** Pulled in from the parent so we can render a "Charles Schwab ·
   *  R4" eyebrow without hard-coding it here. Defaults to a generic
   *  string when not supplied. */
  tournamentLabel?: string;
}

export default function ShareCard({
  data,
  onClose,
  tournamentLabel = "Charles Schwab · R4",
}: Props) {
  useDismissibleOverlay(true, onClose);
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    setCopied(true);
    // Real wiring later: html2canvas → blob → navigator.share /
    // download. For the first cut we just flip the button label.
  };
  return (
    <div
      className="share-modal"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share your bet win"
    >
      <div className="share-scrim" />
      <button
        type="button"
        className="share-close"
        onClick={onClose}
        aria-label="Close share card"
      >
        ✕
      </button>
      <div
        className="share-card"
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="share-top">
          <span className="share-logo">
            Par<b>dle</b>
          </span>
          <span className="share-live">{tournamentLabel}</span>
        </div>
        <div className="share-won">▲ Bet won</div>
        <div className="share-amt">{data.profitLabel}</div>
        <div className="share-bet">
          {data.player} · {data.market} · {data.currency}
          {data.stake} @ {data.oddsLabel}
        </div>
        <div className="share-meta">
          <span className="share-chip">Tracked shot-by-shot</span>
          {data.groupRank && (
            <span className="share-chip">{data.groupRank}</span>
          )}
          {data.bookedDailyPnl && (
            <span className="share-chip">{data.bookedDailyPnl} today</span>
          )}
        </div>
        <div className="share-foot">PARDLE.APP</div>
      </div>
      <div className="share-actions">
        <button type="button" onClick={handleCopy}>
          {copied ? "Saved ✓" : "Save image"}
        </button>
        <button type="button" className="share-actions-pri" onClick={handleCopy}>
          {copied ? "Copied ✓" : "Share to group"}
        </button>
      </div>
    </div>
  );
}
