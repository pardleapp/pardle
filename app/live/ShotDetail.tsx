"use client";

/**
 * ShotDetail — full-screen overlay opened when a user taps a
 * notable shot (in the feed or in the Shots-of-the-day reel).
 * Matches the pre-redesign site's "open the shot" affordance: the
 * full hole diagram with the shot trajectory drawn on it, the
 * headline + tag, the shot-by-shot sequence from the orchestrator's
 * playByPlay, and a Share button that opens the existing
 * ShotShareCard.
 *
 * Geometry: reuses lib/feed/shot-trace.ts and the ShotTracer
 * component in interactive `full` mode — pinch / drag / scroll to
 * explore the hole and the shot path. No new geometry code, no new
 * data layer; same shape that fed the old sidebar reel.
 *
 * Falls back to the stylised hole drawing from ShotDiagram when
 * trace data isn't available for the event.
 */

import { useEffect, useState } from "react";
import type { FeedEvent } from "@/lib/feed/types";
import ShotTracer from "./ShotTracer";
import ShotDiagram from "./ShotDiagram";
import ShotShareCard, { type ShotShareData } from "./ShotShareCard";
import { abbreviateName } from "@/lib/text/abbreviate";
import { useDismissibleOverlay } from "@/app/_hooks/useDismissibleOverlay";

interface Props {
  event: FeedEvent;
  tournamentLabel?: string;
  onClose: () => void;
}

function tagFor(event: FeedEvent): { label: string; tone: "good" | "bad" } | null {
  if (event.ace) return { label: "ACE", tone: "good" };
  switch (event.result) {
    case "albatross":
      return { label: "ALBATROSS", tone: "good" };
    case "eagle":
      return { label: "EAGLE", tone: "good" };
    case "birdie":
      return { label: "BIRDIE", tone: "good" };
    case "bogey":
      return { label: "BOGEY", tone: "bad" };
    case "double":
      return { label: "DOUBLE", tone: "bad" };
    case "triple-plus":
      return { label: "BLOW-UP", tone: "bad" };
    default:
      return null;
  }
}

/** Build a per-stroke summary list from the trace segments. The
 *  orchestrator's playByPlay drives this — each ShotTraceSegment is
 *  one stroke. We map kind → label and approximate distance from the
 *  segment's normalised length (later replaced with the real
 *  proximityInches / yardage when wired). */
interface StrokeRow {
  num: number;
  label: string;
}

function strokeListFromEvent(event: FeedEvent): StrokeRow[] {
  const segments = event.trace?.segments ?? [];
  if (segments.length === 0) return [];
  return segments.map((s, i) => {
    const label = (() => {
      if (i === 0 && s.kind !== "putt") return "Tee shot";
      if (s.kind === "putt") {
        // Multi-putt — first putt vs follow-up.
        const puttIdx = segments
          .slice(0, i + 1)
          .filter((x) => x.kind === "putt").length;
        if (puttIdx === 1) return "First putt";
        if (puttIdx === 2) return "Second putt";
        if (puttIdx === 3) return "Third putt";
        return `Putt ${puttIdx}`;
      }
      const isLast = i === segments.length - 1;
      if (isLast) return "Approach to the cup";
      return `Stroke ${i + 1}`;
    })();
    return { num: i + 1, label };
  });
}

export default function ShotDetail({
  event,
  tournamentLabel,
  onClose,
}: Props) {
  useDismissibleOverlay(true, onClose);
  const [shareOpen, setShareOpen] = useState(false);
  const tag = tagFor(event);
  const strokes = strokeListFromEvent(event);
  const hasTrace =
    !!event.trace && (event.trace.segments?.length ?? 0) > 0;
  const isBad = event.lowlight === true;

  // Apply pv-theme-body so the brand bar / nav re-skin paper while
  // the detail is open. Matches the rest of the redesigned surfaces.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pv-theme-body");
    return () => {
      document.documentElement.classList.remove("pv-theme-body");
    };
  }, []);

  const shareData: ShotShareData = {
    kind: isBad ? "worst" : "best",
    headline: event.headline ?? "",
    player: event.playerName,
    hole: typeof event.hole === "number" ? event.hole : null,
    toPar: event.toPar ?? null,
    tag: tag?.label,
    tournamentLabel: tournamentLabel ?? "Live",
  };

  return (
    <div className="sd" role="dialog" aria-modal="true" aria-label="Shot detail">
      <header className="sd-head">
        <button
          type="button"
          className="bd-pv-back"
          onClick={onClose}
          aria-label="Close shot detail"
        >
          ←
        </button>
        <div className="bd-pv-title">
          <div className="bd-pv-title-nm">
            {abbreviateName(event.playerName)}
          </div>
          <div className="bd-pv-title-mk">
            {tournamentLabel ?? "Live"}
            {typeof event.round === "number" ? ` · R${event.round}` : ""}
          </div>
        </div>
      </header>

      <div className="sd-body">
        <div className="sd-diagram">
          {hasTrace && event.trace ? (
            <ShotTracer trace={event.trace} mode="full" />
          ) : (
            <ShotDiagram event={event} size="wide" />
          )}
        </div>

        <section className="sd-meta">
          <div className="sd-meta-tag-row">
            {tag && (
              <span className={`shots-reel-tag shots-reel-tag-${tag.tone}`}>
                {tag.label}
              </span>
            )}
            {typeof event.hole === "number" && (
              <span className="sd-meta-hole">Hole {event.hole}</span>
            )}
            {event.toPar && (
              <span
                className={`sd-meta-topar${
                  event.toPar.startsWith("+") ? " sd-meta-topar-over" : ""
                }`}
              >
                {event.toPar}
              </span>
            )}
          </div>
          <h2 className="sd-headline">{event.headline}</h2>
          <p className="sd-player">{event.playerName}</p>
        </section>

        {strokes.length > 0 && (
          <section className="sd-section">
            <h4 className="bd-sec-h">Shot by shot</h4>
            <ol className="sd-strokes">
              {strokes.map((s) => (
                <li key={s.num} className="sd-stroke">
                  <span className="sd-stroke-num">{s.num}</span>
                  <span className="sd-stroke-label">{s.label}</span>
                </li>
              ))}
            </ol>
            {!hasTrace && (
              <p className="sd-stroke-note">
                Full shot-by-shot data wasn&apos;t recorded for this hole —
                showing a stylised diagram above.
              </p>
            )}
          </section>
        )}
      </div>

      <footer className="sd-foot">
        <button
          type="button"
          className="bd-pv-share"
          onClick={() => setShareOpen(true)}
        >
          Share this shot
        </button>
      </footer>

      {shareOpen && (
        <ShotShareCard
          data={shareData}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
