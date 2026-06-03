"use client";

/**
 * ShotShareCard — Pardle-branded screenshot-ready card for sharing
 * a Best-of-day / Worst-of-day shot from the feed. Reuses the same
 * .share-* CSS the bet-win share card uses; only the data shape
 * + icon + statusLabel differ.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  Par[dle]                CHARLES SCHWAB · R4 │
 *   │                                              │
 *   │  ⛳ BEST OF THE DAY                          │
 *   │  Hole-out from 150                           │
 *   │                                              │
 *   │  R. Henley · H17 · −12                       │
 *   │  [Tracked shot-by-shot]                      │
 *   │  [BIRDIE]                                    │
 *   │                                              │
 *   │  PARDLE.APP                                  │
 *   └──────────────────────────────────────────────┘
 *
 *   [ Save image ] [ Share to group ]
 *
 * Copy guardrails — no third-party data source names, no latency
 * figures. Emojis allowed on the share-card itself (per the brief).
 */

import { useState } from "react";
import { useDismissibleOverlay } from "@/app/_hooks/useDismissibleOverlay";

export interface ShotShareData {
  /** "best" or "worst" — drives the status icon + label. */
  kind: "best" | "worst";
  /** Headline like "Hole-out from 150" / "4-putt from 6 ft". */
  headline: string;
  player: string;
  /** Hole number — drives the H17 label. */
  hole: number | null;
  /** Total-to-par display ("−12" / "E" / "+3"). */
  toPar: string | null;
  /** Result chip — BIRDIE / EAGLE / BLOW-UP — optional. */
  tag?: string;
  /** Tournament eyebrow — "Charles Schwab · R4". */
  tournamentLabel: string;
}

interface Props {
  data: ShotShareData;
  onClose: () => void;
}

export default function ShotShareCard({ data, onClose }: Props) {
  useDismissibleOverlay(true, onClose);
  const [copied, setCopied] = useState(false);
  const handleCopy = () => setCopied(true);

  const statusIcon = data.kind === "best" ? "⛳" : "💀";
  const statusLabel =
    data.kind === "best" ? "Best of the day" : "Worst of the day";

  return (
    <div
      className="share-modal"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share this shot"
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
        className="share-card share-card-shot"
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="share-top">
          <span className="share-logo">
            Par<b>dle</b>
          </span>
          <span className="share-live">{data.tournamentLabel}</span>
        </div>
        <div className="share-won share-won-shot">
          <span aria-hidden="true">{statusIcon}</span> {statusLabel}
        </div>
        <div className="share-shot-headline">{data.headline}</div>
        <div className="share-bet">
          {data.player}
          {data.hole != null ? ` · H${data.hole}` : ""}
          {data.toPar ? ` · ${data.toPar}` : ""}
        </div>
        <div className="share-meta">
          {data.tag && (
            <span className="share-chip share-chip-tag">{data.tag}</span>
          )}
          <span className="share-chip">Tracked shot-by-shot</span>
        </div>
        <div className="share-foot">PARDLE.APP</div>
      </div>
      <div className="share-actions">
        <button type="button" onClick={handleCopy}>
          {copied ? "Saved ✓" : "Save image"}
        </button>
        <button
          type="button"
          className="share-actions-pri"
          onClick={handleCopy}
        >
          {copied ? "Copied ✓" : "Share to group"}
        </button>
      </div>
    </div>
  );
}
